import { describe, it, expect } from "vitest";
import { Session, type Doc } from "../src/app/lib/session.ts";
import {
  addLayer, removeLayer, moveLayer, duplicateLayer, setParam, setLayout, placement, hasOwnLayout, patchLayer,
  layerOrigin, isChanged, baseLayer, resetSetting, resetLayer, removedLayers, restoreLayer, newVideo, detachVideo, setVideo,
  laneOf, laneChanged, laneInherited, setLane, addLane, removeLane, resetLane, lanesOfLayer,
  modsOf, modOrigin, addMod, setMod, removeMod, resetMod, frontToBack, addTrack, renameTrack, moveTrack, removeTrack, setTrackFile, trackIdFor, mixTrackId, setTempo, addTempoChange, moveTempoChange, removeTempoChange, setDownbeat, tempoSegments, paletteOf, paletteOrigin, setPaletteSlot, resetPaletteSlot, layerColor, layerColorHex, setLayerColor, addColorLane, colorLanesOf, setGenerator, setSpans, addEffect, removeEffect, setEffectParam, moveEffect, layerOf, layersOf, isInherited,
} from "../src/app/lib/edits.ts";
import { validateProject, buildProject, resolveVideo } from "../../../packages/core/src/index.ts";

const L = { landscape: { x: 0.5, y: 0.5, w: 1, h: 1 } };
const grid = { tempo: [{ bar: 1, bpm: 120, beatsPerBar: 4 }], downbeat: 0 };
const doc = (): Doc => ({
  song: { version: 2, title: "t", grid: structuredClone(grid), tracks: [{ id: "mix", name: "Mix", file: "m.wav", mix: true }, { id: "bass", name: "303", file: "b.wav" }] },
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

describe("layout", () => {
  it("sets one layout family, leaving the others; clears fixed layout parameters", () => {
    const d = doc();
    setParam(d, "full", "ring", "x", 0.2);
    expect(placement(layerOf(d, "full", "ring")!, "landscape").x).toBe(0.2); // a fixed parameter wins
    setLayout(d, "full", "ring", "landscape", { x: 0.3, y: 0.4, w: 0.5, h: 0.6, rotation: 15 });
    const l = layerOf(d, "full", "ring")!;
    expect(l.layout.landscape).toEqual({ x: 0.3, y: 0.4, w: 0.5, h: 0.6, rotation: 15 });
    expect(l.params?.x).toBeUndefined();
    expect(placement(l, "landscape").x).toBe(0.3);
  });
  it("a portrait video borrows the landscape layout until it's changed there", () => {
    const d = doc();
    const l = layerOf(d, "reel", "ring")!;
    expect(hasOwnLayout(l, "portrait")).toBe(false);
    expect(placement(l, "portrait")).toEqual({ x: 0.5, y: 0.5, w: 1, h: 1, rotation: 0 });
    setLayout(d, "reel", "ring", "portrait", { x: 0.5, y: 0.3, w: 0.9, h: 0.4 });
    expect(d.videos.reel!.layers).toEqual([{ id: "ring", layout: { portrait: { x: 0.5, y: 0.3, w: 0.9, h: 0.4 } } }]);
    expect(layerOf(d, "reel", "ring")!.layout.landscape).toEqual({ x: 0.5, y: 0.5, w: 1, h: 1 }); // inherited, untouched
    expect(layerOf(d, "full", "ring")!.layout.portrait).toBeUndefined();                       // the base untouched
  });
});

describe("inheritance: marking, resetting, restoring", () => {
  it("tells layers added here from inherited ones, and inherited ones changed here", () => {
    const d = doc();
    addLayer(d, "reel", "pulseGrid");
    expect(layerOrigin(d, "reel", "pulseGrid")).toBe("own");
    expect(layerOrigin(d, "reel", "ring")).toBe("inherited");
    setParam(d, "reel", "ring", "radius", 0.5);
    expect(layerOrigin(d, "reel", "ring")).toBe("changed");
    expect(isChanged(d, "reel", "ring", { param: "radius" })).toBe(true);
    expect(isChanged(d, "reel", "ring", { param: "spike" })).toBe(false);
    expect(isChanged(d, "full", "ring", { param: "radius" })).toBe(false); // no base: nothing to go back to
    expect(baseLayer(d, "reel", "ring")!.params).toEqual({ radius: 0.3 });
  });
  it("resets one setting to the base's; with nothing left changed, the layer is plain inherited again", () => {
    const d = doc();
    setParam(d, "reel", "ring", "radius", 0.5);
    setLayout(d, "reel", "ring", "portrait", { x: 0.5, y: 0.3, w: 1, h: 0.5 });
    patchLayer(d, "reel", "ring", { blend: "add" });
    resetSetting(d, "reel", "ring", { param: "radius" });
    expect(layerOf(d, "reel", "ring")!.params!.radius).toBe(0.3);
    resetSetting(d, "reel", "ring", { layout: "portrait" });
    expect(layerOf(d, "reel", "ring")!.layout.portrait).toBeUndefined();
    expect(layerOrigin(d, "reel", "ring")).toBe("changed");
    resetSetting(d, "reel", "ring", { field: "blend" });
    expect(layerOrigin(d, "reel", "ring")).toBe("inherited");
    expect(d.videos.reel!.layers).toBeUndefined();
  });
  it("resets a whole layer, and restores a removed one with its automation", () => {
    const d = doc();
    setParam(d, "reel", "ring", "radius", 0.5);
    setSpans(d, "reel", "ring", [{ from: 9 }]);
    resetLayer(d, "reel", "ring");
    expect(layerOf(d, "reel", "ring")).toEqual(layerOf(d, "full", "ring"));
    removeLayer(d, "reel", "ring");
    expect(removedLayers(d, "reel").map((l) => l.id)).toEqual(["ring"]);
    expect(resolveVideo("reel", (n) => d.videos[n]!).automation).toEqual([]);
    restoreLayer(d, "reel", "ring");
    expect(removedLayers(d, "reel")).toEqual([]);
    expect(layerOf(d, "reel", "ring")).toEqual(layerOf(d, "full", "ring"));
    expect(resolveVideo("reel", (n) => d.videos[n]!).automation!.map((a) => a.target)).toEqual(["ring.radius"]);
    expect(d.videos.reel).toEqual(doc().videos.reel);
  });
});

describe("video actions", () => {
  it("makes a new video: blank, built on another, or an independent copy", () => {
    const d = doc();
    expect(newVideo(d, { name: "Short: the drop", format: "shorts" })).toBe("short-the-drop");
    expect(d.videos["short-the-drop"]).toMatchObject({ version: 2, name: "Short: the drop", format: "shorts", layers: [] });
    const b = newVideo(d, { name: "Reel 2", format: "reels", from: { video: "reel", how: "base" } });
    expect(d.videos[b]).toMatchObject({ base: "reel", format: "reels" });
    expect(layersOf(d, b).map((l) => l.id)).toEqual(["ring", "title"]);
    const c = newVideo(d, { name: "Reel", format: "reels", from: { video: "reel", how: "copy" } });
    expect(c).toBe("reel-3"); // "reel" and "reel-2" are taken
    expect(d.videos[c]!.base).toBeUndefined();
    expect(layersOf(d, c)).toEqual(layersOf(d, "reel"));
    expect(d.videos[c]!.range).toEqual({ from: 9, to: 17 });
    for (const v of [b, c]) expect(valid(d, v)).toEqual([]);
  });
  it("detaches a video from its base without changing how it looks", () => {
    const d = doc();
    setParam(d, "reel", "ring", "radius", 0.5);
    const before = resolveVideo("reel", (n) => d.videos[n]!);
    detachVideo(d, "reel");
    expect(d.videos.reel!.base).toBeUndefined();
    expect(layersOf(d, "reel")).toEqual(before.layers);
    expect(d.videos.reel!.format).toBe("reels");
    setParam(d, "full", "ring", "radius", 0.9); // the old base changing no longer affects it
    expect(layerOf(d, "reel", "ring")!.params!.radius).toBe(0.5);
  });
  it("sets and clears a video's own settings", () => {
    const d = doc();
    setVideo(d, "reel", { format: "shorts", name: "A short" });
    expect(d.videos.reel).toMatchObject({ format: "shorts", name: "A short" });
    setVideo(d, "reel", { range: undefined });
    expect(d.videos.reel!.range).toBeUndefined();
  });
});

describe("automation lanes", () => {
  it("adds, replaces and removes a lane", () => {
    const d = doc();
    addLane(d, "full", "ring.spike", { bar: 5 }, 0.5);
    expect(laneOf(d, "full", "ring.spike")!.points).toEqual([{ bar: 5, v: 0.5 }]);
    addLane(d, "full", "ring.spike", { bar: 9 }, 0.9); // already there: unchanged
    expect(laneOf(d, "full", "ring.spike")!.points).toEqual([{ bar: 5, v: 0.5 }]);
    setLane(d, "full", "ring.spike", [{ bar: 9, v: 1 }, { bar: 5, v: 0.5, curve: "smooth" }]);
    expect(laneOf(d, "full", "ring.spike")!.points).toEqual([{ bar: 5, v: 0.5, curve: "smooth" }, { bar: 9, v: 1 }]);
    expect(lanesOfLayer(d, "full", "ring").map((a) => a.target)).toEqual(["ring.radius", "ring.spike"]);
    removeLane(d, "full", "ring.spike");
    expect(laneOf(d, "full", "ring.spike")).toBeUndefined();
    expect(valid(d, "full")).toEqual([]);
  });
  it("in a reel: an inherited lane, changed here (↺ back), or removed here", () => {
    const d = doc();
    expect(laneInherited(d, "reel", "ring.radius")).toBe(true);
    setLane(d, "reel", "ring.radius", [{ bar: 9, v: 0.8 }]);
    expect(laneChanged(d, "reel", "ring.radius")).toBe(true);
    expect(laneOf(d, "full", "ring.radius")!.points).toEqual([{ bar: 1, v: 0.2 }, { bar: 9, v: 0.4 }]); // base untouched
    resetLane(d, "reel", "ring.radius");
    expect(laneOf(d, "reel", "ring.radius")).toEqual(laneOf(d, "full", "ring.radius"));
    removeLane(d, "reel", "ring.radius");
    expect(laneOf(d, "reel", "ring.radius")).toBeUndefined();
    expect(laneOf(d, "full", "ring.radius")).toBeDefined();
    resetLane(d, "reel", "ring.radius");
    expect(laneOf(d, "reel", "ring.radius")).toBeDefined();
  });
});

describe("audio modulation", () => {
  it("adds, changes (including its source) and removes a modulation", () => {
    const d = doc();
    expect(addMod(d, "full", { target: "ring.radius", source: "bass.env", amount: 0.5 })).toBe(true);
    expect(addMod(d, "full", { target: "ring.radius", source: "bass.env", amount: 0.9 })).toBe(false); // that source already drives it
    setMod(d, "full", "ring.radius", "bass.env", { target: "ring.radius", source: "bass.env", amount: 0.7, curve: "square" });
    expect(modsOf(d, "full", "ring.radius")).toEqual([{ target: "ring.radius", source: "bass.env", amount: 0.7, curve: "square" }]);
    setMod(d, "full", "ring.radius", "bass.env", { target: "ring.radius", source: "bass.low", amount: 0.7 });
    expect(modsOf(d, "full", "ring.radius").map((m) => m.source)).toEqual(["bass.low"]);
    removeMod(d, "full", "ring.radius", "bass.low");
    expect(modsOf(d, "full", "ring.radius")).toEqual([]);
    expect(valid(d, "full")).toEqual([]);
  });
  it("in a reel: inherited (base), changed here (↺ back), removed here only", () => {
    const d = doc(); // the full video modulates ring.lineWidth from bass.env
    expect(modOrigin(d, "reel", { target: "ring.lineWidth", source: "bass.env" })).toBe("base");
    setMod(d, "reel", "ring.lineWidth", "bass.env", { target: "ring.lineWidth", source: "bass.env", amount: 3 });
    expect(modOrigin(d, "reel", { target: "ring.lineWidth", source: "bass.env" })).toBe("changed");
    expect(modsOf(d, "full", "ring.lineWidth")[0]!.amount).toBe(1); // base untouched
    resetMod(d, "reel", "ring.lineWidth", "bass.env");
    expect(modsOf(d, "reel", "ring.lineWidth")[0]!.amount).toBe(1);
    removeMod(d, "reel", "ring.lineWidth", "bass.env");
    expect(modsOf(d, "reel", "ring.lineWidth")).toEqual([]);
    expect(modsOf(d, "full", "ring.lineWidth").length).toBe(1);
    // switching an inherited modulation's source: the base's is cancelled here, the new one is the reel's own
    resetMod(d, "reel", "ring.lineWidth", "bass.env");
    setMod(d, "reel", "ring.lineWidth", "bass.env", { target: "ring.lineWidth", source: "mix.high", amount: 1 });
    expect(modsOf(d, "reel", "ring.lineWidth").map((m) => m.source)).toEqual(["mix.high"]);
    expect(modOrigin(d, "reel", { target: "ring.lineWidth", source: "mix.high" })).toBe("own");
    expect(valid(d, "reel")).toEqual([]);
  });
});

describe("independent review fixes", () => {
  it("a new layer's id is unused anywhere in the project, so a base layer never takes a reel's layer id", () => {
    const d = doc();
    const inReel = addLayer(d, "reel", "pulseGrid");
    const inBase = addLayer(d, "full", "pulseGrid");
    expect(inBase).not.toBe(inReel);
    expect(layersOf(d, "reel").filter((l) => l.generator === "pulseGrid").length).toBe(2);
    // removing a base layer and adding the same kind again doesn't revive the reel's changes to the old one
    setParam(d, "reel", "ring", "radius", 0.9);
    removeLayer(d, "full", "ring");
    expect(addLayer(d, "full", "acidRing")).not.toBe("ring");
  });
  it("setting a field to undefined removes it (nothing the saved file would lose)", () => {
    const d = doc();
    patchLayer(d, "full", "ring", { track: undefined });
    expect("track" in d.videos.full!.layers!.find((l) => l.id === "ring")!).toBe(false);
  });
  it("layers front first are exactly the reverse of the renderer's drawing order, ties included", () => {
    const ls = [{ id: "a", z: 1 }, { id: "b", z: 5 }, { id: "c", z: 5 }, { id: "d", z: 0 }];
    const drawn = [...ls].sort((x, y) => x.z - y.z).map((l) => l.id); // the renderer: d a b c (c drawn last, on top)
    expect(frontToBack(ls).map((l) => l.id)).toEqual([...drawn].reverse());
  });
});

describe("tracks", () => {
  it("adds a track named after its file, with an id of its own", () => {
    const d = doc();
    expect(addTrack(d, "media/.incoming/1/Pad bounce.wav")).toBe("pad-bounce");
    expect(d.song.tracks.at(-1)).toEqual({ id: "pad-bounce", name: "Pad bounce", file: "media/.incoming/1/Pad bounce.wav" });
    expect(trackIdFor(d, "Pad bounce")).toBe("pad-bounce-2");
    expect(trackIdFor(d, "Bass (303)")).toBe("bass-303");
    expect(valid(d, "full")).toEqual([]);
  });
  it("renames, reorders and gives a track a new file without touching what listens to it", () => {
    const d = doc();
    renameTrack(d, "bass", "Bass (303)");
    setTrackFile(d, "bass", "media/b2.wav");
    moveTrack(d, "bass", -1);
    expect(d.song.tracks.map((t) => t.id)).toEqual(["bass", "mix"]);
    expect(d.song.tracks[0]).toMatchObject({ id: "bass", name: "Bass (303)", file: "media/b2.wav" });
    expect(layerOf(d, "full", "ring")!.track).toBe("bass");
  });
  it("removing a track moves its layers and modulations to the mix, in every video", () => {
    const d = doc();
    d.videos.reel!.modulations = [{ target: "ring.spin", source: "bass.onset", amount: 0.2 }];
    expect(removeTrack(d, "bass")).toEqual(["Acid ring"]);
    expect(d.song.tracks.map((t) => t.id)).toEqual(["mix"]);
    expect(layerOf(d, "full", "ring")!.track).toBeUndefined();
    expect(modsOf(d, "full", "ring.lineWidth")[0]!.source).toBe("mix.env");
    expect(modsOf(d, "reel", "ring.spin")[0]!.source).toBe("mix.onset");
    expect(valid(d, "full")).toEqual([]);
    expect(valid(d, "reel")).toEqual([]);
  });
  it("the mix can't be removed", () => {
    const d = doc();
    removeTrack(d, "mix");
    expect(mixTrackId(d)).toBe("mix");
    expect(d.song.tracks).toHaveLength(2);
  });
});

describe("saving moved files", () => {
  it("renames them through the whole undo history (undo never brings back a path that's gone)", () => {
    const s = new Session(doc());
    s.apply("add track", (d) => { addTrack(d, "media/.incoming/1/pad.wav"); });
    s.apply("rename", (d) => renameTrack(d, "pad", "Pad"));
    s.renameFiles({ "media/.incoming/1/pad.wav": "media/pad.wav" });
    s.markSaved();
    expect(s.doc.song.tracks.at(-1)!.file).toBe("media/pad.wav");
    s.undo();
    expect(s.doc.song.tracks.at(-1)!.file).toBe("media/pad.wav");
    expect(s.dirty).toBe(true);
  });
});

describe("tempo", () => {
  it("sets BPM and beats per bar, within sense", () => {
    const d = doc();
    setTempo(d, 1, { bpm: 155.0004, beatsPerBar: 3 });
    expect(tempoSegments(d)).toEqual([{ bar: 1, bpm: 155, beatsPerBar: 3 }]);
    setTempo(d, 1, { bpm: 0, beatsPerBar: 2.5 });                      // ignored
    expect(tempoSegments(d)[0]).toMatchObject({ bpm: 155, beatsPerBar: 3 });
  });
  it("adds a change at a whole bar with the values in effect, moves and removes it; bar 1 stays", () => {
    const d = doc();
    expect(addTempoChange(d, 16.6)).toBe(17);
    expect(addTempoChange(d, 17)).toBeNull();                           // already one there
    expect(addTempoChange(d, 1)).toBeNull();
    expect(tempoSegments(d)).toEqual([{ bar: 1, bpm: 120, beatsPerBar: 4 }, { bar: 17, bpm: 120, beatsPerBar: 4 }]);
    setTempo(d, 17, { bpm: 90 });
    moveTempoChange(d, 17, 9);
    expect(tempoSegments(d).map((s) => [s.bar, s.bpm])).toEqual([[1, 120], [9, 90]]);
    moveTempoChange(d, 1, 5);                                            // bar 1 doesn't move
    removeTempoChange(d, 1);
    removeTempoChange(d, 9);
    expect(tempoSegments(d).map((s) => s.bar)).toEqual([1]);
    expect(valid(d, "full")).toEqual([]);
  });
  it("sets where bar 1 starts, to the millisecond, never before the start of the audio", () => {
    const d = doc();
    setDownbeat(d, 0.12345);
    expect(d.song.grid!.downbeat).toBe(0.123);
    setDownbeat(d, -0.5);
    expect(d.song.grid!.downbeat).toBe(0);
  });
});

describe("colour", () => {
  it("the palette: the song's, overridden per video; a base's override is inherited", () => {
    const d = doc();
    setPaletteSlot(d, "full", "accent", "#ff0000", "song");
    expect(paletteOf(d, "reel").accent).toBe("#ff0000");
    expect(paletteOrigin(d, "reel", "accent")).toBe("song");
    setPaletteSlot(d, "full", "accent", "#00ff00", "video");
    expect(paletteOf(d, "full").accent).toBe("#00ff00");
    expect(paletteOrigin(d, "reel", "accent")).toBe("base");
    setPaletteSlot(d, "reel", "accent", "#0000ff", "video");
    expect(paletteOrigin(d, "reel", "accent")).toBe("video");
    expect(paletteOf(d, "full").accent).toBe("#00ff00");
    resetPaletteSlot(d, "reel", "accent");
    expect(paletteOf(d, "reel").accent).toBe("#00ff00");
    expect(d.videos.reel!.palette).toBeUndefined();
    expect(valid(d, "reel")).toEqual([]);
  });
  it("a layer's colour follows its slot, can follow another or be its own; a reel changes one colour, keeping the rest", () => {
    const d = doc();
    expect(layerColor(d, "full", "ring", "highlight")).toBe("accent");
    setLayerColor(d, "full", "ring", "line", "#123456");
    setLayerColor(d, "full", "ring", "highlight", "extra2");
    expect(layerColorHex(d, "full", "ring", "line")).toBe("#123456");
    expect(layerColorHex(d, "full", "ring", "highlight")).toBe(paletteOf(d, "full").extra2);
    setLayerColor(d, "reel", "ring", "highlight", "#abcdef");
    expect(layerColor(d, "reel", "ring", "line")).toBe("#123456");          // kept from the base
    expect(layerColor(d, "reel", "ring", "highlight")).toBe("#abcdef");
    expect(isChanged(d, "reel", "ring", { color: "highlight" })).toBe(true);
    expect(isChanged(d, "reel", "ring", { color: "line" })).toBe(false);
    resetSetting(d, "reel", "ring", { color: "highlight" });
    expect(layerColor(d, "reel", "ring", "highlight")).toBe("extra2");
    setLayerColor(d, "full", "ring", "highlight", "accent");                // back to its default: nothing stored
    expect(layerOf(d, "full", "ring")!.colors).toEqual({ line: "#123456" });
    expect(valid(d, "full")).toEqual([]);
  });
  it("colour lanes start with one colour and are listed apart from number lanes", () => {
    const d = doc();
    addColorLane(d, "full", "palette.accent", { bar: 9 }, "#ff0000");
    addColorLane(d, "full", "ring.line", { bar: 1 }, "#00ff00");
    addColorLane(d, "full", "ring.line", { bar: 5 }, "#0000ff");             // already there: no change
    expect(colorLanesOf(d, "full", "palette.").map((l) => l.target)).toEqual(["palette.accent"]);
    expect(colorLanesOf(d, "full", "ring.")[0]!.points).toEqual([{ bar: 1, c: "#00ff00" }]);
    expect(lanesOfLayer(d, "full", "ring").map((l) => l.target)).toEqual(["ring.radius"]);
    expect(valid(d, "full")).toEqual([]);
  });
});
