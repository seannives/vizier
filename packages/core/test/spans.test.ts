import { describe, it, expect } from "vitest";
import { spansToSeconds, spanGain, splitSpans, validateSpans } from "../src/spans.ts";
import { mergeVideos, validateProject, type Project } from "../src/index.ts";

// 120 BPM, 4/4, bar 1 at 0 s: a bar is 2 s, a beat 0.5 s
const grid = { tempo: [{ bar: 1, bpm: 120, beatsPerBar: 4 }], downbeat: 0 };

describe("layer on-spans", () => {
  it("converts bars to seconds and fades from beats", () => {
    expect(spansToSeconds([{ from: 3, to: 5, fadeIn: 2, fadeOut: 1 }], grid)).toEqual([{ from: 4, to: 8, fadeIn: 1, fadeOut: 0.5 }]);
    expect(spansToSeconds([{ from: 49 }], grid)[0]!.to).toBe(Infinity);
  });
  it("is on inside a span, off outside it (the end is exclusive), and fades at the edges", () => {
    const s = spansToSeconds([{ from: 3, to: 5, fadeIn: 2, fadeOut: 1 }], grid);
    expect(spanGain(s, 3.99)).toBe(0);
    expect(spanGain(s, 4)).toBe(0);
    expect(spanGain(s, 4.5)).toBeCloseTo(0.5);
    expect(spanGain(s, 6)).toBe(1);
    expect(spanGain(s, 7.75)).toBeCloseTo(0.5);
    expect(spanGain(s, 8)).toBe(0);
    expect(spanGain(undefined, 123)).toBe(1); // no spans: always on
  });
  it("switches generators at bar 49: one layer up to it, the other from it", () => {
    const ring = spansToSeconds([{ from: 1, to: 49 }], grid), grid2 = spansToSeconds([{ from: 49 }], grid);
    const t49 = 48 * 2;
    expect([spanGain(ring, t49 - 0.01), spanGain(grid2, t49 - 0.01)]).toEqual([1, 0]);
    expect([spanGain(ring, t49), spanGain(grid2, t49)]).toEqual([0, 1]);
  });
  it("splits a span at a bar, keeping the fades at the outer ends", () => {
    expect(splitSpans([{ from: 1, to: 9, fadeIn: 2, fadeOut: 4 }], 5)).toEqual([{ from: 1, to: 5, fadeIn: 2 }, { from: 5, to: 9, fadeOut: 4 }]);
    expect(splitSpans([{ from: 1 }], 17)).toEqual([{ from: 1, to: 17 }, { from: 17 }]);
    expect(splitSpans([{ from: 1, to: 9 }], 9)).toEqual([{ from: 1, to: 9 }]); // at the edge: nothing to split
  });
  it("validates spans", () => {
    expect(validateSpans([{ from: 5, to: 3 }], grid, "layer a")[0]).toMatch(/ends before it starts/);
    expect(validateSpans([{ from: 5 }], undefined, "layer a")[0]).toMatch(/need a tempo/);
  });
  it("a reel can replace a layer's spans", () => {
    const base = { version: 2 as const, layers: [{ id: "ring", generator: "acidRing", z: 0, layout: {}, spans: [{ from: 1, to: 49 }] }] };
    const reel = { version: 2 as const, base: "full", layers: [{ id: "ring", spans: [{ from: 81 }] }] };
    expect(mergeVideos(base, reel).layers![0]!.spans).toEqual([{ from: 81 }]);
  });
  it("project validation reports bad spans", () => {
    const p: Project = { version: 2, title: "t", seed: 1, tracks: { mix: "m.wav" }, mix: "mix", grid, palette: {},
      layers: [{ id: "a", generator: "acidRing", z: 0, layout: { landscape: { x: 0.5, y: 0.5, w: 1, h: 1 } }, spans: [{ from: 9, to: 9 }] }] };
    expect(validateProject(p).join()).toMatch(/ends before it starts/);
  });
});
