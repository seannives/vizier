/**
 * Modulation presets: one-click combinations of audio modulations (and sometimes an effect) for a layer, tuned for
 * dark, acid techno. Applying one adds ordinary modulations, which then show under M in the layer panel to adjust
 * or remove: a preset is a starting point, not a setting of its own.
 */
import { GENERATORS, EFFECTS, LAYER_PARAMS, type Modulation } from "../../../../../packages/core/src/index.ts";
import type { Doc } from "./session.ts";
import { layerOf, addMod, setMod, modsOf, addEffect, setEffectParam, mixTrackId } from "./edits.ts";

interface PresetMod {
  /** Parameters to try, in order: the first the layer has gets the modulation ("glow.amount": an effect's). */
  params: string[];
  feature: string;
  amount: number;
  curve?: Modulation["curve"];
  /** Which track's sound: the layer's own (default), or the mix (where the kick is). */
  track?: "layer" | "mix";
}
export interface Preset {
  id: string;
  label: string;
  /** What it does and when to reach for it (the menu's tooltip). */
  description: string;
  mods: PresetMod[];
  /** An effect it adds first (if the layer doesn't have one of that kind), with these settings. */
  effect?: { type: string; params?: Record<string, number> };
}

export const PRESETS: Preset[] = [
  {
    id: "pump", label: "Pump with the kick",
    description: "The layer swells on every kick (the mix's low end), like a speaker cone. Best on one central layer.",
    mods: [{ params: ["w"], feature: "low", amount: 0.06, curve: "square", track: "mix" }, { params: ["h"], feature: "low", amount: 0.06, curve: "square", track: "mix" }],
  },
  {
    id: "flash", label: "Flash on hits",
    description: "Every hit in the layer's track flashes it towards white, fading over a third of a second. Put it on drums or percussion.",
    mods: [{ params: ["lightness"], feature: "hit", amount: 0.45 }],
  },
  {
    id: "filter", label: "Colour follows the filter",
    description: "The colours turn round the colour wheel as the sound brightens: on a 303, the hue rides the filter sweep.",
    mods: [{ params: ["hueShift"], feature: "centroid", amount: 70 }],
  },
  {
    id: "squelch", label: "Acid squelch",
    description: "For a layer on the 303: the filter opening pushes its highlight colour and glow, and changes in the line make it spike.",
    mods: [
      { params: ["acid"], feature: "centroid", amount: 1.2 },
      { params: ["spike", "warp", "height"], feature: "flux", amount: 0.4 },
      { params: ["glow.amount"], feature: "centroid", amount: 1.5 },
    ],
  },
  {
    id: "breathe", label: "Breathe with the track",
    description: "Brightness rises and falls with the track's loudness: pads and long notes swell, gaps go dark.",
    mods: [{ params: ["brightness", "lightness"], feature: "env", amount: 0.8, curve: "sqrt" }],
  },
  {
    id: "shake", label: "Kick shake",
    description: "A jolt on every hit: the layer twists a few degrees and snaps back. Subtle on big layers, wild on small ones.",
    mods: [{ params: ["rotation"], feature: "hit", amount: 3, curve: "square" }],
  },
  {
    id: "glitch", label: "Glitch on hits",
    description: "Adds an RGB split that tears on every hit, and lets the hits push it further. Good on drums, and on text.",
    effect: { type: "rgbSplit", params: { offset: 2, kick: 24, glitch: 0.5 } },
    mods: [{ params: ["rgbSplit.glitch"], feature: "hit", amount: 0.4 }],
  },
  {
    id: "rush", label: "Rush on the build",
    description: "As the track gets busier (more change in its sound), things get wilder: tunnels twist, lasers sweep wider, mazes rewire more tiles, flow fields fold.",
    // (not speeds: a position worked out as beats × speed jumps when the speed moves; these change the shape instead)
    mods: [
      { params: ["twist"], feature: "flux", amount: 1.2 },
      { params: ["sweep"], feature: "flux", amount: 40 },
      { params: ["change"], feature: "flux", amount: 0.5 },
      { params: ["warp"], feature: "flux", amount: 1 },
    ],
  },
];

/** The parameters a layer has, as modulation targets after "<layer>.": its own, its generator's, its effects'. */
function targetsOf(doc: Doc, video: string, layerId: string): Set<string> {
  const l = layerOf(doc, video, layerId);
  if (!l) return new Set();
  const out = new Set<string>([...LAYER_PARAMS, ...(GENERATORS[l.generator]?.params ?? [])].map((p) => p.name));
  for (const e of l.effects ?? []) for (const p of EFFECTS[e.type]?.params ?? []) out.add(`${e.id ?? e.type}.${p.name}`);
  return out;
}

/** Whether a preset does anything on this layer (one of its modulations finds a parameter, or it adds an effect). */
export function presetFits(doc: Doc, video: string, layerId: string, p: Preset): boolean {
  const t = targetsOf(doc, video, layerId);
  return !!p.effect || p.mods.some((m) => m.params.some((x) => t.has(x)));
}

/**
 * Apply a preset to a layer: add its effect if the layer has none of that kind, then its modulations (on the first
 * parameter of each that the layer has; replacing the amount where that track's feature already drives it).
 * Returns the targets it modulated.
 */
export function applyPreset(doc: Doc, video: string, layerId: string, p: Preset): string[] {
  const l = layerOf(doc, video, layerId);
  if (!l) return [];
  if (p.effect && !(l.effects ?? []).some((e) => e.type === p.effect!.type)) {
    addEffect(doc, video, layerId, p.effect.type);
    const i = (layerOf(doc, video, layerId)!.effects ?? []).length - 1;
    for (const [k, v] of Object.entries(p.effect.params ?? {})) setEffectParam(doc, video, layerId, i, k, v);
  }
  const targets = targetsOf(doc, video, layerId);
  const done: string[] = [];
  for (const m of p.mods) {
    const param = m.params.find((x) => targets.has(x));
    if (!param) continue;
    const target = `${layerId}.${param}`;
    const track = m.track === "mix" ? mixTrackId(doc) : (layerOf(doc, video, layerId)!.track ?? mixTrackId(doc));
    const mod: Modulation = { target, source: `${track}.${m.feature}`, amount: m.amount, ...(m.curve ? { curve: m.curve } : {}) };
    if (modsOf(doc, video, target).some((o) => o.source === mod.source)) setMod(doc, video, target, mod.source, mod);
    else addMod(doc, video, mod);
    done.push(target);
  }
  return done;
}
