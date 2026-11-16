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
  version: 2, title: "t", seed: 1, tracks: { mix: "m.wav", bass: "b.wav" }, mix: "mix", palette: {},
  layers: [{ id: "bass", track: "bass", generator: "acidRing", z: 1, params: { radius: 1 }, layout: { landscape: { x: 0.5, y: 0.5, w: 1, h: 1 } } }],
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
  it("validates the demo project's videos", async () => {
    const { buildProject, resolveVideo } = await import("../src/index.ts");
    const read = (f: string) => JSON.parse(readFileSync(new URL(`../../../projects/demo/${f}`, import.meta.url), "utf8"));
    const song = read("song.json");
    for (const v of ["full", "reel"]) {
      const video = resolveVideo(v, (n) => read(`videos/${n}.json`));
      expect(validateProject(buildProject(song, video, (t) => t.file))).toEqual([]);
    }
  });
  it("catches references to unknown layers and tracks", () => {
    const bad = { ...project, automation: [{ target: "nope.x", points: [] }], modulations: [{ target: "bass.x", source: "drums.env", amount: 1 }] };
    expect(validateProject(bad)).toHaveLength(2); // unknown automation target ("nope"), unknown track ("drums")
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

describe("beat grid", () => {
  it("converts bars at a steady tempo, with bar 1 at the downbeat", async () => {
    const { barToSeconds } = await import("../src/index.ts");
    const g = { tempo: [{ bar: 1, bpm: 155 }] };
    expect(barToSeconds(1, g)).toBe(0);
    expect(barToSeconds(49, g)).toBeCloseTo((48 * 4 * 60) / 155);
    expect(barToSeconds(161, g)).toBeCloseTo(247.74, 2);
  });
  it("handles a lead-in before bar 1 (downbeat) and bar 0.x", async () => {
    const { barToSeconds, secondsToBar } = await import("../src/index.ts");
    const g = { tempo: [{ bar: 1, bpm: 120 }], downbeat: 0.75 };
    expect(barToSeconds(1, g)).toBe(0.75);
    expect(barToSeconds(2, g)).toBeCloseTo(2.75);
    expect(barToSeconds(0.75, g)).toBeCloseTo(0.25); // the last beat of the lead-in bar
    expect(secondsToBar(2.75, g)).toBeCloseTo(2, 6);
  });
  it("handles tempo and metre changes", async () => {
    const { barToSeconds, secondsToBar, barLabel } = await import("../src/index.ts");
    const g = { tempo: [{ bar: 1, bpm: 120 }, { bar: 9, bpm: 60 }, { bar: 11, bpm: 60, beatsPerBar: 3 }] };
    expect(barToSeconds(9, g)).toBeCloseTo(16);       // 8 bars × 2 s
    expect(barToSeconds(11, g)).toBeCloseTo(24);      // + 2 bars × 4 s
    expect(barToSeconds(12, g)).toBeCloseTo(27);      // + 1 bar of 3/4 at 60
    expect(secondsToBar(20, g)).toBeCloseTo(10, 6);
    expect(barLabel(12 + 2 / 3, g)).toBe("12.3");
    expect(barLabel(5, { ...g, barLabelOffset: 16 })).toBe("21.1");
  });
  it("evaluates lanes written in bars", () => {
    const p: Project = { ...project, grid: { tempo: [{ bar: 1, bpm: 120 }] }, automation: [{ target: "bass.radius", points: [{ bar: 1, v: 0 }, { bar: 3, v: 1 }] }], modulations: [] };
    const r = new ParamResolver(p);
    expect(r.value("bass.radius", 0, 2, () => 0)).toBeCloseTo(0.5); // bar 2 starts at 2 s at 120 BPM
  });
  it("rejects bars without a tempo", () => {
    const p: Project = { ...project, automation: [{ target: "bass.radius", points: [{ bar: 5, v: 1 }] }] };
    expect(validateProject(p).join()).toMatch(/tempo/);
  });
});

describe("videos building on other videos", () => {
  it("overrides layers by id, merges params, replaces lanes by target, and can remove things", async () => {
    const { resolveVideo } = await import("../src/index.ts");
    const files: Record<string, any> = {
      full: { version: 2, profiles: ["youtube"], seed: 3,
        layers: [{ id: "ring", generator: "acidRing", params: { radius: 1, spin: 0.1 }, layout: { landscape: { x: 0.5, y: 0.5, w: 1, h: 1 } } },
                 { id: "title", generator: "typeText", text: "hi", layout: { landscape: { x: 0.5, y: 0.9, w: 1, h: 0.1 } } }],
        automation: [{ target: "ring.radius", points: [{ bar: 1, v: 1 }] }, { target: "ring.spin", points: [{ bar: 1, v: 0 }] }],
        modulations: [{ target: "ring.radius", source: "bass.env", amount: 1 }] },
      reel: { version: 2, base: "full", profiles: ["reels"], range: { from: 9, to: 17 },
        layers: [{ id: "ring", params: { radius: 2 }, layout: { portrait: { x: 0.5, y: 0.4, w: 1, h: 0.5 } } }, { id: "title", remove: true },
                 { id: "caption", generator: "typeText", text: "new", layout: { portrait: { x: 0.5, y: 0.2, w: 1, h: 0.1 } } }],
        automation: [{ target: "ring.spin", points: [] }, { target: "caption.reveal", points: [{ bar: 9, v: 0 }, { bar: 10, v: 1 }] }],
        modulations: [{ target: "ring.radius", source: "bass.env", remove: true }] },
    };
    const v = resolveVideo("reel", (n) => files[n]);
    expect(v.format).toBe("reels"); // old "profiles" lists become one format
    expect(v.profiles).toBeUndefined();
    expect(v.seed).toBe(3);
    expect(v.range).toEqual({ from: 9, to: 17 });
    const ring = v.layers!.find((l) => l.id === "ring")!;
    expect(ring.params).toEqual({ radius: 2, spin: 0.1 });
    expect(Object.keys(ring.layout!)).toEqual(["landscape", "portrait"]);
    expect(v.layers!.map((l) => l.id)).toEqual(["ring", "caption"]);
    expect(v.automation!.map((a) => a.target)).toEqual(["ring.radius", "caption.reveal"]);
    expect(v.modulations).toEqual([]);
  });
  it("detects loops", async () => {
    const { resolveVideo } = await import("../src/index.ts");
    const files: Record<string, any> = { a: { version: 2, base: "b" }, b: { version: 2, base: "a" } };
    expect(() => resolveVideo("a", (n) => files[n])).toThrow(/loop/);
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

describe("plugins", () => {
  it("every generator and effect declares sane parameters", async () => {
    const { GENERATORS, EFFECTS } = await import("../src/index.ts");
    for (const plug of [...Object.values(GENERATORS), ...Object.values(EFFECTS)]) {
      expect(plug.label.length).toBeGreaterThan(0);
      const names = new Set<string>();
      for (const s of plug.params) {
        expect(names.has(s.name), `${plug.id}.${s.name} duplicated`).toBe(false);
        names.add(s.name);
        expect(s.min, `${plug.id}.${s.name}`).toBeLessThanOrEqual(s.default);
        expect(s.default, `${plug.id}.${s.name}`).toBeLessThanOrEqual(s.max);
      }
    }
  });
  it("validates parameters and effect targets against the declarations", () => {
    const p: Project = {
      ...project, modulations: [],
      layers: [{ ...project.layers[0]!, params: { radius: 1, nope: 2 }, effects: [{ type: "trails" }, { type: "sparkle" }] }],
      automation: [{ target: "bass.trails.zoom", points: [{ t: 0, v: 1 }] }, { target: "bass.trails.nope", points: [{ t: 0, v: 1 }] }],
    };
    const errs = validateProject(p).join("\n");
    expect(errs).toMatch(/"nope" is not a parameter of acidRing/);
    expect(errs).toMatch(/unknown effect "sparkle"/);
    expect(errs).toMatch(/"bass.trails.nope" doesn't exist/);
    expect(errs).not.toMatch(/bass.trails.zoom/);
  });
});
