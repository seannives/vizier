import { describe, it, expect } from "vitest";
import { Session, type Doc } from "../src/app/lib/session.ts";
import {
  addLayer, removeLayer, moveLayer, duplicateLayer, setParam, setGenerator, setSpans, addEffect, removeEffect, setEffectParam, moveEffect, layerOf, layersOf, isInherited,
} from "../src/app/lib/edits.ts";
import { validateProject, buildProject, resolveVideo } from "../../../packages/core/src/index.ts";

const L = { landscape: { x: 0.5, y: 0.5, w: 1, h: 1 } };
const grid = { tempo: [{ bar: 1, bpm: 120, beatsPerBar: 4 }], downbeat: 0 };
const doc = (): Doc => ({
  song: { version: 2, title: "t", grid, tracks: [{ id: "mix", name: "Mix", file: "m.wav", mix: true }, { id: "bass", name: "303", file: "b.wav" }] },
  videos: {
    full: {
      version: 2, format: "youtube",
      layers: [
        { id: "ring", name: "Acid ring", generator: "acidRing", track: "bass", z: 1, params: { radius: 0.3 }, effects: [{ type: "trails" }], layout: L },
        { id: "title", generator: "typeText", z: 2, text: "hi", layout: L },
      ],
      automation: [{ target: "ring.radius", points: [{ bar: 1, v: 0.2 }, { bar: 9, v: 0.4 }] }],
      modulations: [{ target: "ring.lineWidth", source: "bass.env", amount: 1 }],
    },
    reel: { version: 2, base: "full", format: "reels", range: { from: 9, to: 17 } },
  },
});
const valid = (d: Doc, v: string) => validateProject(buildProject(d.song, resolveVideo(v, (n) => d.videos[n]!), (t) => t.file));

describe("editing layers", () => {
  it("adds a layer on top with a fresh id, full frame, on the given track", () => {
    const d = doc();
    const id = addLayer(d, "full", "pulseGrid", "bass");
    expect(id).toBe("pulseGrid");
    expect(addLayer(d, "full", "pulseGrid")).toBe("pulseGrid-2");
    const l = layerOf(d, "full", id)!;
    expect(l.z).toBe(3);
    expect(l.track).toBe("bass");
    expect(l.layout.portrait).toEqual({ x: 0.5, y: 0.5, w: 1, h: 1 });
    expect(valid(d, "full")).toEqual([]);
  });
  it("in a reel, edits to an inherited layer go to the reel only, as overrides", () => {
    const d = doc();
    setParam(d, "reel", "ring", "radius", 0.45);
    expect(d.videos.reel!.layers).toEqual([{ id: "ring", params: { radius: 0.45 } }]);
    expect(d.videos.full!.layers![0]!.params).toEqual({ radius: 0.3 });   // the base is untouched
    expect(layerOf(d, "reel", "ring")!.params).toEqual({ radius: 0.45 });
    expect(isInherited(d, "reel", "ring")).toBe(true);
  });
  it("removes a layer and what aims at it; in a reel it cancels the inherited layer, lanes and modulations", () => {
    const own = doc();
    removeLayer(own, "full", "ring");
    expect(layersOf(own, "full").map((l) => l.id)).toEqual(["title"]);
    expect(own.videos.full!.automation).toBeUndefined();
    expect(own.videos.full!.modulations).toBeUndefined();
    const reel = doc();
    removeLayer(reel, "reel", "ring");
    expect(layersOf(reel, "reel").map((l) => l.id)).toEqual(["title"]);
    expect(layersOf(reel, "full").map((l) => l.id)).toEqual(["ring", "title"]);
    expect(valid(reel, "reel")).toEqual([]);
  });
  it("reorders by swapping depth with the neighbour", () => {
    const d = doc();
    moveLayer(d, "full", "ring", 1);
    expect([layerOf(d, "full", "ring")!.z, layerOf(d, "full", "title")!.z]).toEqual([2, 1]);
    moveLayer(d, "full", "ring", 1); // already on top
    expect(layerOf(d, "full", "ring")!.z).toBe(2);
  });
  it("changes generator, dropping parameters and automation that no longer fit", () => {
    const d = doc();
    expect(setGenerator(d, "full", "ring", "pulseGrid")).toBe("ring");
    const l = layerOf(d, "full", "ring")!;
    expect(l.generator).toBe("pulseGrid");
    expect(l.params).toBeUndefined();
    expect(l.effects).toEqual([{ type: "trails" }]);
    expect(d.videos.full!.automation).toBeUndefined();
    expect(valid(d, "full")).toEqual([]);
  });
  it("in a reel, changing an inherited layer's generator replaces it with a new layer", () => {
    const d = doc();
    const id = setGenerator(d, "reel", "ring", "pulseGrid");
    expect(id).toBe("pulseGrid");
    expect(layersOf(d, "reel").map((l) => [l.id, l.generator, l.name])).toContainEqual(["pulseGrid", "pulseGrid", "Acid ring"]);
    expect(layersOf(d, "reel").some((l) => l.id === "ring")).toBe(false);
    expect(valid(d, "reel")).toEqual([]);
  });
  it("sets spans, and 'whole song' clears them (an inherited layer gets an explicit empty list)", () => {
    const d = doc();
    setSpans(d, "full", "ring", [{ from: 49 }, { from: 1, to: 17 }]);
    expect(layerOf(d, "full", "ring")!.spans).toEqual([{ from: 1, to: 17 }, { from: 49 }]);
    setSpans(d, "reel", "ring", null);
    expect(layerOf(d, "reel", "ring")!.spans).toEqual([]);
    setSpans(d, "full", "ring", null);
    expect("spans" in layerOf(d, "full", "ring")!).toBe(false);
  });
  it("edits the effect chain", () => {
    const d = doc();
    addEffect(d, "full", "ring", "glow");
    addEffect(d, "full", "ring", "glow");
    expect(layerOf(d, "full", "ring")!.effects).toEqual([{ type: "trails" }, { type: "glow" }, { type: "glow", id: "glow2" }]);
    setEffectParam(d, "full", "ring", 1, "amount", 0.8);
    moveEffect(d, "full", "ring", 1, -1);
    expect(layerOf(d, "full", "ring")!.effects![0]).toEqual({ type: "glow", params: { amount: 0.8 } });
    removeEffect(d, "full", "ring", 0);
    expect(layerOf(d, "full", "ring")!.effects!.map((e) => e.id ?? e.type)).toEqual(["trails", "glow2"]);
    expect(valid(d, "full")).toEqual([]);
  });
});

describe("undo for slider drags", () => {
  it("a run of merged changes is one undo step, until sealed", () => {
    const s = new Session(doc());
    for (const v of [0.31, 0.32, 0.33]) s.apply("radius", (d) => setParam(d, "full", "ring", "radius", v), { merge: "ring.radius" });
    s.seal();
    s.apply("radius", (d) => setParam(d, "full", "ring", "radius", 0.5), { merge: "ring.radius" });
    expect(layerOf(s.doc, "full", "ring")!.params!.radius).toBe(0.5);
    s.undo();
    expect(layerOf(s.doc, "full", "ring")!.params!.radius).toBe(0.33);
    s.undo();
    expect(layerOf(s.doc, "full", "ring")!.params!.radius).toBe(0.3);
    expect(s.canUndo).toBe(false);
  });
});

describe("duplicating", () => {
  it("puts the copy just behind the original, with its automation", () => {
    const d = doc();
    const id = duplicateLayer(d, "full", "title");
    expect(id).toBe("typeText");
    const z = (i: string) => layerOf(d, "full", i)!.z;
    expect(z(id)).toBeLessThan(z("title"));
    expect(z(id)).toBeGreaterThan(z("ring"));
    expect(layerOf(d, "full", id)!.name).toBe("title copy");
    const id2 = duplicateLayer(d, "full", "ring");
    expect(z(id2)).toBeLessThan(z("ring"));
    expect(d.videos.full!.automation!.map((a) => a.target)).toContain(`${id2}.radius`);
  });
});
