import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const vizier = (...args: string[]) => spawnSync("bash", [root + "bin/vizier", ...args], { cwd: root, encoding: "utf8" });

describe("the vizier command", () => {
  // the demo's audio isn't in git; generate it (on a fresh machine, e.g. CI) so validate finds every file
  beforeAll(() => { const r = vizier("demo"); expect(r.status).toBe(0); }, 60_000);

  it("lists its commands", () => {
    const r = vizier("help");
    expect(r.status).toBe(0);
    for (const c of ["render", "editor", "live", "validate", "analyze", "migrate", "demo"]) expect(r.stdout).toMatch(new RegExp(`\\n  ${c} `));
  });
  it("explains a command, with help or --help", () => {
    expect(vizier("help", "render").stdout).toMatch(/--still-bar/);
    expect(vizier("render", "--help").stdout).toMatch(/--still-bar/);
  });
  it("runs a command and passes on its exit code", () => {
    const ok = vizier("validate", "projects/demo");
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/✓ song.json/);
    expect(ok.stderr).not.toMatch(/ExperimentalWarning/);
    expect(vizier("validate", "projects/does-not-exist").status).not.toBe(0);
    expect(vizier("nope").status).toBe(1);
  });
});

describe("render options the editor uses", () => {
  const chrome = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find((p) => p && existsSync(p));
  const it2 = chrome && !process.env.VIZIER_QUICK ? it : it.skip;
  it2("--progress reports every frame batch; the file appears only when complete (no .partial left)", () => {
    const out = mkdtempSync(join(tmpdir(), "vizier-out-")) + "/clip.mp4";
    const r = vizier("render", "projects/demo", "--video", "full", "--profile", "draft", "--bars", "2-2.5", "--progress", "--out", out);
    expect(r.status, r.stderr).toBe(0);
    const progress = r.stderr.split("\n").filter((l) => l.startsWith("PROGRESS "));
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.at(-1)).toMatch(/^PROGRESS (\d+) \1$/);                    // ends at done = total
    expect(existsSync(out)).toBe(true);
    expect(existsSync(out.replace(/\.mp4$/, ".partial.mp4"))).toBe(false);
  }, 180_000);
});
