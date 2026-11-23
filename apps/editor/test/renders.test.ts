import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RenderQueue, listRenders, againOptions, type RenderJob } from "../src/renders.ts";

// A stand-in for `vizier render`: progress lines, then the file (or a failure, or a long run to cancel)
let dir: string, cli: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vizier-renders-"));
  mkdirSync(join(dir, "output"));
  cli = join(dir, "fake-render.mjs");
  writeFileSync(cli, `
    import { writeFileSync } from "node:fs";
    const [dir, , video] = process.argv.slice(2);
    if (video === "broken") { console.error("[vizier] Problems in demo/broken:\\n  layer x: unknown generator"); process.exit(1); }
    const slow = video === "slow", n = slow ? 1000 : 4;
    writeFileSync(dir + "/output/" + video + ".partial.mp4", "partial");
    for (let i = 1; i <= n; i++) { console.error("PROGRESS " + i + " " + n); await new Promise((r) => setTimeout(r, slow ? 50 : 5)); }
    writeFileSync(dir + "/output/" + video + "-youtube.mp4", "video");
    console.error("[vizier] wrote " + dir + "/output/" + video + "-youtube.mp4 (4 frames, 0.13 s, 30.00 fps) in 0.0 min");
  `);
});
const until = async (f: () => boolean, ms = 10_000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 20)); } };

describe("the render queue", () => {
  it("runs one render at a time, reads its progress and the file it wrote", async () => {
    const q = new RenderQueue(cli, false);
    const [a, b] = q.add(dir, ["full", "reel"], false) as [RenderJob, RenderJob];
    expect(a.status).toBe("running");
    expect(b.status).toBe("queued");
    expect(q.busy(dir)).toBe(true);
    await until(() => b.status === "done");
    expect(a).toMatchObject({ status: "done", done: 4, total: 4, file: "output/full-youtube.mp4" });
    expect(b.file).toBe("output/reel-youtube.mp4");
    expect(q.busy(dir)).toBe(false);
  });
  it("a failed render says why (the command's last lines)", async () => {
    const q = new RenderQueue(cli, false);
    const [j] = q.add(dir, ["broken"], false) as [RenderJob];
    await until(() => j.status === "failed");
    expect(j.error).toMatch(/unknown generator/);
  });
  it("cancelling stops it and removes its unfinished file; a queued one never starts", async () => {
    const q = new RenderQueue(cli, false);
    const [j, k] = q.add(dir, ["slow", "full"], false) as [RenderJob, RenderJob];
    await until(() => j.done > 2);
    q.cancel(k.id);
    q.cancel(j.id);
    await until(() => !!j.endedAt);
    expect(j.status).toBe("cancelled");
    expect(k.status).toBe("cancelled");
    expect(existsSync(join(dir, "output/slow.partial.mp4"))).toBe(false);
    await new Promise((r) => setTimeout(r, 200));
    expect(existsSync(join(dir, "output/full-youtube.mp4"))).toBe(false);
  });
});

describe("the renders in output/", () => {
  it("lists the videos, newest first, with what the .json beside each says; not unfinished ones", () => {
    writeFileSync(join(dir, "output/full-youtube.mp4"), "x".repeat(1000));
    writeFileSync(join(dir, "output/full-youtube.json"), JSON.stringify({ renderedAt: "2026-11-23T12:00:00Z", video: "full", profile: "youtube", range: { fromSeconds: 0, toSeconds: 62, frames: 1860 }, vizier: { commit: "abc1234", localChanges: false } }));
    writeFileSync(join(dir, "output/reel-reels.partial.mp4"), "x");
    writeFileSync(join(dir, "output/old.mp4"), "x");
    const r = listRenders(dir);
    expect(r.map((x) => x.file).sort()).toEqual(["output/full-youtube.mp4", "output/old.mp4"]);
    expect(r.find((x) => x.file === "output/full-youtube.mp4")).toMatchObject({ video: "full", profile: "youtube", seconds: 62, frames: 1860, bytes: 1000, commit: "abc1234" });
  });
});

describe("a render made again", () => {
  it("keeps the options it was made with (a draft, a few bars, the whole song), not the project, video, GPU or output name", () => {
    expect(againOptions(["projects/demo", "--video", "full", "--profile", "draft", "--bars", "24-26", "--gpu"])).toEqual(["--profile", "draft", "--bars", "24-26"]);
    expect(againOptions(["projects/demo", "--video", "reel", "--whole", "--progress", "--gpu", "--out", "/tmp/x.mp4", "--keep"])).toEqual(["--whole"]);
    expect(againOptions(undefined)).toEqual([]);
  });
  it("listing a render gives those options", () => {
    writeFileSync(join(dir, "output/full-draft-b24-26.mp4"), "x");
    writeFileSync(join(dir, "output/full-draft-b24-26.json"), JSON.stringify({ video: "full", command: ["projects/demo", "--video", "full", "--profile", "draft", "--bars", "24-26"] }));
    expect(listRenders(dir)[0]!.options).toEqual(["--profile", "draft", "--bars", "24-26"]);
  });
});
