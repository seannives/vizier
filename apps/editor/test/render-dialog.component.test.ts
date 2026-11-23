import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/svelte";
import RenderDialog from "../src/app/components/RenderDialog.svelte";
import type { RenderJob } from "../src/renders.ts";

const job = (id: number, status: RenderJob["status"], extra: Partial<RenderJob> = {}): RenderJob =>
  ({ id, dir: "/p", video: "reel", whole: false, status, done: 0, total: 100, startedAt: id * 1000, endedAt: status === "running" || status === "queued" ? undefined : id * 1000 + 42_000, ...extra });
const show = (jobs: RenderJob[]) => render(RenderDialog, {
  video: "reel", videoName: "Reel test 1", videos: { reel: "Reel test 1" }, rangeLabel: "bars 1–9", hasRange: true, dirty: [], jobs, files: [],
  onsave: vi.fn(), onclose: vi.fn(), onrefresh: vi.fn(),
});
const text = (r: ReturnType<typeof show>) => r.container.querySelector('[aria-label="Render"]')!.textContent!.replace(/\s+/g, " ");

describe("the render dialog's jobs", () => {
  it("render, cancel, render again: shows the new render running, then done; never the old cancel beside it", () => {
    let r = show([job(1, "done", { file: "output/reel-reels.mp4" }), job(2, "cancelled"), job(3, "running", { done: 40 })]);
    expect(text(r)).toMatch(/40% · 40\/100 frames/);
    expect(text(r)).not.toMatch(/cancelled/);
    r.unmount();
    r = show([job(1, "done", { file: "output/reel-reels.mp4" }), job(2, "cancelled"), job(3, "done", { file: "output/reel-reels.mp4" })]);
    expect(text(r)).toMatch(/Reel test 1: done in 42 s/);
    expect(text(r)).not.toMatch(/cancelled/);
  });
  it("a cancel or failure shows while it's the last thing that happened to that video", () => {
    const r = show([job(1, "done", { file: "output/reel-reels.mp4" }), job(2, "failed", { error: "unknown generator" })]);
    expect(text(r)).toMatch(/Reel test 1: failed.*unknown generator/);
    expect(text(r)).not.toMatch(/done in/);
  });
});
