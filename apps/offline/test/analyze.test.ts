import { describe, it, expect } from "vitest";
import { analyze } from "../src/analyze.ts";
import { DEMO, makeDemoTracks } from "../../../scripts/demo-audio.ts";

describe("analyze (on the generated demo song)", () => {
  const t = makeDemoTracks();
  const a = analyze(Object.entries(t).map(([id, samples]) => ({ id, samples })), "mix", DEMO.sampleRate);
  it("finds the tempo", () => expect(a.bpm).toBeCloseTo(DEMO.bpm, 0));
  it("finds bar 1 after the lead-in, to within 20 ms", () => expect(Math.abs(a.downbeat - DEMO.leadIn)).toBeLessThan(0.02));
  it("finds where each track plays", () => {
    const active = (id: string) => a.tracks.find((x) => x.id === id)!.active;
    expect(active("bass")).toEqual([[9, 24], [29, 32]]);
    expect(active("pad")).toEqual([[25, 32]]);
  });
  it("suggests the section changes", () => {
    const bars = a.sectionChanges.map((c) => c.bar);
    for (const b of [9, 25, 29]) expect(bars).toContain(b);
  });
});
