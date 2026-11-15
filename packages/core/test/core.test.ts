import { describe, it, expect } from "vitest";
import { evaluateLane, thinRecording, ParamResolver, validateProject, layoutFor, PROFILES, frameRng, type Project } from "../src/index.ts";
import { readFileSync } from "node:fs";

describe("automation lanes", () => {
  const lane = { target: "a.x", points: [{ t: 0, v: 0 }, { t: 10, v: 1, curve: "hold" as const }, { t: 20, v: 0, curve: "smooth" as const }, { t: 30, v: 1 }] };
  it("interpolates linearly, holds, and eases", () => {
    expect(evaluateLane(lane, -5)).toBe(0);
    expect(evaluateLane(lane, 5)).toBeCloseTo(0.5);
    expect(evaluateLane(lane, 15)).toBe(1);        // hold keeps the left value
    expect(evaluateLane(lane, 22.5)).toBeLessThan(0.25); // smooth starts slower than linear
    expect(evaluateLane(lane, 25)).toBeCloseTo(0.5);
    expect(evaluateLane(lane, 99)).toBe(1);
  });
  it("thins a recorded knob move to a few breakpoints that reproduce it", () => {
    const samples = Array.from({ length: 301 }, (_, i) => ({ t: i / 30, v: i < 150 ? i / 150 : 1 }));
    const thinned = thinRecording("a.x", samples, 0.005);
    expect(thinned.points.length).toBeLessThan(6);
    for (const s of samples) expect(Math.abs(evaluateLane(thinned, s.t)! - s.v)).toBeLessThan(0.01);
  });
});

const project: Project = {
  version: 1, title: "t", seed: 1, stems: { main: "m.wav", bass: "b.wav" }, palette: {},
  layers: [{ id: "bass", stem: "bass", generator: "acidRing", z: 1, params: { radius: 1 }, layout: { landscape: { x: 0.5, y: 0.5, w: 1, h: 1 } } }],
  automation: [{ target: "bass.radius", points: [{ t: 0, v: 1 }, { t: 10, v: 2 }] }],
  modulations: [{ target: "bass.radius", source: "bass.env", amount: 0.5 }],
};

describe("parameter stack", () => {
  const feats = (env: number) => (_s: string, f: string) => (f === "env" ? env : 0);
  it("adds automation and modulation, and an override wins", () => {
    const r = new ParamResolver(project);
    expect(r.value("bass.radius", 1, 5, feats(0))).toBeCloseTo(1.5);
    expect(r.value("bass.radius", 1, 5, feats(1))).toBeCloseTo(2.0);
    expect(r.value("bass.spike", 0.3, 5, feats(1))).toBe(0.3); // untouched params keep their base
    r.overrides.set("bass.radius", 9);
    expect(r.value("bass.radius", 1, 5, feats(1))).toBe(9);
  });
});

describe("project", () => {
  it("validates the example project", () => {
    const p = JSON.parse(readFileSync(new URL("../../../examples/ozgun-acid/project.json", import.meta.url), "utf8"));
    expect(validateProject(p)).toEqual([]);
  });
  it("catches references to unknown layers and stems", () => {
    const bad = { ...project, automation: [{ target: "nope.x", points: [] }], modulations: [{ target: "bass.x", source: "drums.env", amount: 1 }] };
    expect(validateProject(bad)).toHaveLength(2);
  });
  it("falls back from portrait to landscape layout", () => {
    expect(layoutFor(project.layers[0]!, "portrait")).toEqual({ x: 0.5, y: 0.5, w: 1, h: 1 });
  });
  it("has the platform profiles", () => {
    expect(PROFILES.reels).toMatchObject({ width: 1080, height: 1920 });
    expect(PROFILES.igfeed).toMatchObject({ width: 1080, height: 1350 });
  });
  it("seeded randomness is reproducible per frame", () => {
    expect(frameRng(1, 100)()).toBe(frameRng(1, 100)());
    expect(frameRng(1, 100)()).not.toBe(frameRng(1, 101)());
  });
});

describe("bars timebase", () => {
  it("converts Live-style bar numbers at 155 BPM", async () => {
    const { barToSeconds } = await import("../src/index.ts");
    expect(barToSeconds(1, { bpm: 155 })).toBe(0);
    expect(barToSeconds(49, { bpm: 155 })).toBeCloseTo(48 * 4 * 60 / 155);
    expect(barToSeconds(161, { bpm: 155 })).toBeCloseTo(247.74, 2);
  });
  it("evaluates lanes written in bars", () => {
    const p: Project = { ...project, tempo: { bpm: 120 }, automation: [{ target: "bass.radius", points: [{ bar: 1, v: 0 }, { bar: 3, v: 1 }] }], modulations: [] };
    const r = new ParamResolver(p);
    expect(r.value("bass.radius", 0, 2, () => 0)).toBeCloseTo(0.5); // bar 2 starts at 2 s at 120 BPM
  });
  it("rejects bars without a tempo", () => {
    const p: Project = { ...project, automation: [{ target: "bass.radius", points: [{ bar: 5, v: 1 }] }] };
    expect(validateProject(p).join()).toMatch(/tempo/);
  });
});

describe("H.264 level selection", () => {
  it("picks the lowest High-profile level that fits", async () => {
    const { avcCodecFor } = await import("../src/browser/encoder.ts");
    expect(avcCodecFor(1920, 1080, 30)).toBe("avc1.640028"); // 4.0
    expect(avcCodecFor(1080, 1920, 30)).toBe("avc1.640028"); // vertical 1080p: 4.0
    expect(avcCodecFor(1920, 1080, 60)).toBe("avc1.64002A"); // 4.2
    expect(avcCodecFor(3840, 2160, 30)).toBe("avc1.640033"); // 5.1
  });
});
