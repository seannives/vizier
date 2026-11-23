import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import TracksPanel from "../src/app/components/TracksPanel.svelte";
import type { Doc } from "../src/app/lib/session.ts";

const doc: Doc = {
  song: { version: 2, title: "t", grid: { tempo: [{ bar: 1, bpm: 120, beatsPerBar: 4 }], downbeat: 0 },
    tracks: [{ id: "mix", name: "Mix", file: "media/mix.wav", mix: true }, { id: "hats", name: "Hats", file: "media/hats.wav" }, { id: "bass", name: "Bass", file: "media/bass.wav" }] },
  videos: {},
};
const props = (checks: Record<string, unknown>) => ({ doc, project: "p", checks: checks as never, media: [], edit: vi.fn(), onadd: vi.fn(), onreplace: vi.fn(), onremove: vi.fn(), onrefreshmedia: vi.fn() });
beforeEach(() => localStorage.clear());

describe("track warnings", () => {
  it("say when a stem is late or can't be checked; OK hides one, and it stays hidden for that file", async () => {
    const checks = { "media/mix.wav": { seconds: 200, mixSeconds: 200, offset: 0 }, "media/hats.wav": { seconds: 200, mixSeconds: 200, offset: null }, "media/bass.wav": { seconds: 198, mixSeconds: 200, offset: 0.25 } };
    const r = render(TracksPanel, props(checks));
    const warn = (id: string) => r.container.querySelector(`[data-track="${id}"] .warn`);
    expect(warn("mix")).toBeNull();
    expect(warn("hats")!.textContent).toMatch(/couldn't tell whether it lines up/);
    expect(warn("bass")!.textContent).toMatch(/0\.25 s late.*2\.0 s shorter/);
    await fireEvent.click(warn("hats")!.querySelector("button")!);
    expect(warn("hats")).toBeNull();
    expect(warn("bass")).not.toBeNull();
    r.unmount();
    // remembered: shown again only for a different file (another length or shift)
    const again = render(TracksPanel, props(checks));
    expect(again.container.querySelector('[data-track="hats"] .warn')).toBeNull();
    again.unmount();
    const changed = render(TracksPanel, props({ ...checks, "media/hats.wav": { seconds: 201, mixSeconds: 200, offset: null } }));
    expect(changed.container.querySelector('[data-track="hats"] .warn')).not.toBeNull();
  });
});
