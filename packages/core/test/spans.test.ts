import { describe, it, expect } from "vitest";
import { spansToSeconds, spanGain, splitSpans, validateSpans } from "../src/spans.ts";
import { addBeats, beatsPerBarAt, nextBeatLine } from "../src/grid.ts";
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

describe("a video built on another: settings that no longer fit drop out", () => {
  const L = { landscape: { x: 0.5, y: 0.5, w: 1, h: 1 } };
  const base = () => ({ version: 2 as const, layers: [
    { id: "ring", generator: "acidRing", z: 0, layout: L, params: { radius: 0.5 } },
    { id: "grid", generator: "pulseGrid", z: 1, layout: L },
  ], automation: [{ target: "grid.density", points: [{ bar: 1, v: 10 }] }], modulations: [{ target: "grid.brightness", source: "mix.env", amount: 1 }] });
  it("a layer removed in the reel takes the base's lanes and modulations with it, even ones added later", () => {
    const m = mergeVideos(base(), { version: 2, layers: [{ id: "grid", remove: true }] });
    expect(m.layers!.map((l) => l.id)).toEqual(["ring"]);
    expect(m.automation).toEqual([]);
    expect(m.modulations).toEqual([]);
  });
  it("the reel's changes to a layer the base has since deleted are ignored, with their lanes and modulations", () => {
    const b = base(); b.layers = b.layers.filter((l) => l.id !== "grid");
    const m = mergeVideos(b, { version: 2, layers: [{ id: "grid", params: { density: 30 } }],
      automation: [{ target: "grid.wave", points: [{ bar: 1, v: 1 }] }], modulations: [{ target: "grid.density", source: "mix.low", amount: 5 }] });
    expect(m.layers!.map((l) => l.id)).toEqual(["ring"]);
    expect(m.automation).toEqual([]);
    expect(m.modulations).toEqual([]);
  });
  it("when the base changes a layer's generator, the reel's settings for the old one drop out (and the base's file is untouched)", () => {
    const b = base(); b.layers[0]!.generator = "pulseGrid";
    const before = JSON.stringify(b);
    const m = mergeVideos(b, { version: 2, layers: [{ id: "ring", params: { spike: 0.9, density: 20 } }],
      automation: [{ target: "ring.spin", points: [{ bar: 1, v: 1 }] }, { target: "post.grain", points: [{ bar: 1, v: 0 }] }],
      modulations: [{ target: "ring.echoes", source: "mix.env", amount: 3 }, { target: "ring.wave", source: "mix.env", amount: 1 }] });
    expect(m.layers![0]!.params).toEqual({ density: 20 });             // radius and spike aren't pulse grid parameters
    expect(m.automation!.map((a) => a.target)).toEqual(["grid.density", "post.grain"]);
    expect(m.modulations!.map((x) => x.target)).toEqual(["grid.brightness", "ring.wave"]);
    expect(JSON.stringify(b)).toBe(before);
  });
  it("a video on its own still reports such settings as errors (typos are caught)", () => {
    const p: Project = { version: 2, title: "t", seed: 1, tracks: { mix: "m" }, mix: "mix", palette: {},
      layers: [{ id: "ring", generator: "acidRing", z: 0, layout: L, params: { radiuss: 1 } as any }], automation: [{ target: "rign.radius", points: [{ t: 0, v: 1 }] }] };
    expect(validateProject(p).length).toBe(2);
  });
});

describe("beats across a metre change (4/4 until bar 17, then 3/4; 120 BPM: a beat is 0.5 s)", () => {
  const g = { tempo: [{ bar: 1, bpm: 120, beatsPerBar: 4 }, { bar: 17, bpm: 120, beatsPerBar: 3 }], downbeat: 0 };
  it("a fade counts beats in the metre where it lies", () => {
    expect(spansToSeconds([{ from: 1, to: 17, fadeOut: 4 }], g)[0]!.fadeOut).toBeCloseTo(2);    // 4 beats of 4/4
    expect(spansToSeconds([{ from: 16.5, to: 30, fadeIn: 4 }], g)[0]!.fadeIn).toBeCloseTo(2);   // 2 beats of 4/4, 2 of 3/4
    expect(spansToSeconds([{ from: 17, to: 30, fadeIn: 3 }], g)[0]!.fadeIn).toBeCloseTo(1.5);   // a bar of 3/4
  });
  it("moves by beats and finds beat lines in each bar's own metre", () => {
    expect(addBeats(17, -4, g)).toBeCloseTo(16);
    expect(addBeats(16.5, 4, g)).toBeCloseTo(17 + 2 / 3);
    expect(addBeats(18, -3, g)).toBeCloseTo(17);
    expect(beatsPerBarAt(16.9, g)).toBe(4);
    expect(beatsPerBarAt(17, g)).toBe(3);
    expect(nextBeatLine(16.75, 1, g)).toBe(17);
    expect(nextBeatLine(17, 1, g)).toBeCloseTo(17 + 1 / 3);
    expect(nextBeatLine(17, -1, g)).toBeCloseTo(16.75);
    expect(nextBeatLine(17 + 1 / 3, -1, g)).toBeCloseTo(17);
  });
});
