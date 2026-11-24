import { describe, it, expect } from "vitest";
import type { Doc } from "../src/app/lib/session.ts";
import { PRESETS, applyPreset, presetFits } from "../src/app/lib/presets.ts";
import { layerOf, modsOf } from "../src/app/lib/edits.ts";
import { validateProject, buildProject, resolveVideo } from "../../../packages/core/src/index.ts";

const L = { landscape: { x: 0.5, y: 0.5, w: 1, h: 1 } };
const doc = (): Doc => ({
  song: { version: 2, title: "t", grid: { tempo: [{ bar: 1, bpm: 155, beatsPerBar: 4 }], downbeat: 0 },
    tracks: [{ id: "mix", name: "Mix", file: "m.wav", mix: true }, { id: "bass", name: "303", file: "b.wav" }, { id: "drums", name: "Drums", file: "d.wav" }] },
  videos: { full: { version: 2, format: "youtube", layers: [
    { id: "ring", generator: "acidRing", track: "bass", z: 1, effects: [{ type: "glow" }], layout: L },
    { id: "tunnel", generator: "tunnel", track: "drums", z: 0, layout: L },
    { id: "title", generator: "typeText", z: 2, text: "hi", layout: L },
  ] } },
});
const P = (id: string) => PRESETS.find((p) => p.id === id)!;
const valid = (d: Doc) => validateProject(buildProject(d.song, resolveVideo("full", (n) => d.videos[n]!), (t) => t.file));

describe("modulation presets", () => {
  it("pump: the layer's size swells with the mix's low end (the kick), whatever the layer's own track", () => {
    const d = doc();
    expect(applyPreset(d, "full", "ring", P("pump"))).toEqual(["ring.w", "ring.h"]);
    expect(modsOf(d, "full", "ring.w")).toEqual([{ target: "ring.w", source: "mix.low", amount: 0.06, curve: "square" }]);
    expect(valid(d)).toEqual([]);
  });
  it("acid squelch on the 303 ring: its highlight, spikes and glow ride the layer's own track", () => {
    const d = doc();
    expect(applyPreset(d, "full", "ring", P("squelch"))).toEqual(["ring.acid", "ring.spike", "ring.glow.amount"]);
    expect(modsOf(d, "full", "ring.acid")[0]!.source).toBe("bass.centroid");
    expect(valid(d)).toEqual([]);
  });
  it("a parameter the layer doesn't have is skipped (or the next one tried); presets that fit nothing aren't offered", () => {
    const d = doc();
    expect(applyPreset(d, "full", "title", P("breathe"))).toEqual(["title.lightness"]);   // no brightness: lightness
    expect(applyPreset(d, "full", "title", P("squelch"))).toEqual([]);                    // nothing of it fits text
    expect(presetFits(d, "full", "title", P("squelch"))).toBe(false);
    expect(presetFits(d, "full", "tunnel", P("rush"))).toBe(true);
  });
  it("glitch adds an RGB split (once) and drives it with hits; applying again changes nothing", () => {
    const d = doc();
    applyPreset(d, "full", "tunnel", P("glitch"));
    expect(layerOf(d, "full", "tunnel")!.effects).toEqual([{ type: "rgbSplit", params: { offset: 2, kick: 24, glitch: 0.5 } }]);
    expect(modsOf(d, "full", "tunnel.rgbSplit.glitch")[0]!.source).toBe("drums.hit");
    const before = JSON.stringify(d);
    applyPreset(d, "full", "tunnel", P("glitch"));
    expect(JSON.stringify(d)).toBe(before);
    expect(valid(d)).toEqual([]);
  });
  it("every preset applies cleanly to every kind of layer", () => {
    for (const p of PRESETS) for (const id of ["ring", "tunnel", "title"]) { const d = doc(); applyPreset(d, "full", id, p); expect(valid(d), `${p.id} on ${id}`).toEqual([]); }
  });
});
