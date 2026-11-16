import { positionToSeconds, type LaneInput } from "./automation.ts";
import { validateGrid, type Grid } from "./grid.ts";
import { GENERATORS } from "./generators/index.ts";
import { EFFECTS } from "./effects/index.ts";
import { LAYER_PARAMS, POST_PARAMS } from "./plugins.ts";
import type { LayoutFamily } from "./profiles.ts";

/** Where a layer sits on the output canvas. Fractions of the canvas, centre-anchored. */
export interface Transform { x: number; y: number; w: number; h: number; rotation?: number }

export type BlendMode = "normal" | "add" | "screen" | "multiply";

/** An effect in a layer's chain. `id` defaults to `type`; give one when a layer uses the same effect twice. */
export interface EffectRef { type: string; id?: string; params?: Record<string, number> }

export interface LayerDef {
  id: string;
  /** Display name (the id never changes, so references survive renaming). */
  name?: string;
  /** Which track's features drive this layer (a track id; default: the mix). */
  track?: string;
  generator: string;
  z: number;
  opacity?: number;
  blend?: BlendMode;
  /** Render this layer at a fraction of its on-screen pixel size (cheap soft layers). */
  resolutionScale?: number;
  params?: Record<string, number>;
  text?: string;
  /** Effects applied to this layer's image, in order. Their parameters are "<layer>.<effect id>.<param>". */
  effects?: EffectRef[];
  /** One transform per layout family; "feed" falls back to "portrait", then "landscape". */
  layout: Partial<Record<LayoutFamily, Transform>>;
}

/** Audio-to-parameter mapping: target += amount * feature (after curve). */
export interface Modulation {
  target: string;           // "layerId.param", e.g. "bass.radius"
  source: string;           // "trackId.feature", e.g. "bass.env"
  amount: number;
  curve?: "linear" | "square" | "sqrt";
}

/** A section of the arrangement, placed in seconds (`t`) or bars (`bar`, 1-based). */
export interface Section { t?: number; bar?: number; name: string }

/** What the renderer works from: a song plus one resolved video (see formats.ts for the files). */
export interface Project {
  version: 2;
  title: string;
  seed: number;
  /** Track id → audio file path. */
  tracks: Record<string, string>;
  trackNames?: Record<string, string>;
  /** The track whose audio goes into the video. */
  mix: string;
  grid?: Grid;
  palette: Record<string, string>;
  sections?: Section[];
  /** The video's bar range: `to` is exclusive. */
  range?: { from?: number; to?: number };
  layers: LayerDef[];
  automation?: LaneInput[];
  modulations?: Modulation[];
}

export function layoutFor(layer: LayerDef, family: LayoutFamily): Transform {
  const order: LayoutFamily[] = family === "feed" ? ["feed", "portrait", "landscape"] : family === "portrait" ? ["portrait", "landscape"] : ["landscape", "portrait"];
  for (const f of order) { const t = layer.layout[f]; if (t) return t; }
  throw new Error(`Layer ${layer.id} has no layout`);
}

/** Every automatable target in a project, with its spec: "<layer>.<param>", "<layer>.<effect>.<param>", "post.<param>". */
export function paramTargets(p: Project): Map<string, { label: string; min: number; max: number; default: number }> {
  const out = new Map<string, { label: string; min: number; max: number; default: number }>();
  for (const s of POST_PARAMS) out.set(`post.${s.name}`, s);
  for (const l of p.layers) {
    for (const s of LAYER_PARAMS) out.set(`${l.id}.${s.name}`, s);
    for (const s of GENERATORS[l.generator]?.params ?? []) out.set(`${l.id}.${s.name}`, s);
    for (const e of l.effects ?? []) for (const s of EFFECTS[e.type]?.params ?? []) out.set(`${l.id}.${e.id ?? e.type}.${s.name}`, s);
  }
  return out;
}

export function validateProject(p: Project): string[] {
  const errs: string[] = [];
  if (p.version !== 2) errs.push("version must be 2");
  if (!(p.mix in p.tracks)) errs.push(`the mix track "${p.mix}" doesn't exist`);
  if (p.grid) errs.push(...validateGrid(p.grid));
  const ids = new Set<string>();
  for (const l of p.layers) {
    if (ids.has(l.id)) errs.push(`duplicate layer id ${l.id}`);
    if (l.id === "post") errs.push(`"post" is reserved and can't be a layer id`);
    ids.add(l.id);
    const gen = GENERATORS[l.generator];
    if (!gen) errs.push(`layer ${l.id}: unknown generator "${l.generator}" (known: ${Object.keys(GENERATORS).join(", ")})`);
    if (!l.layout.landscape && !l.layout.portrait) errs.push(`layer ${l.id} needs a landscape or portrait layout`);
    if (l.track && !(l.track in p.tracks)) errs.push(`layer ${l.id} uses unknown track "${l.track}"`);
    const known = new Set([...(gen?.params ?? []), ...LAYER_PARAMS].map((s) => s.name));
    for (const k of Object.keys(l.params ?? {})) if (gen && !known.has(k)) errs.push(`layer ${l.id}: "${k}" is not a parameter of ${l.generator}`);
    const effIds = new Set<string>();
    for (const e of l.effects ?? []) {
      const def = EFFECTS[e.type];
      const id = e.id ?? e.type;
      if (!def) { errs.push(`layer ${l.id}: unknown effect "${e.type}" (known: ${Object.keys(EFFECTS).join(", ")})`); continue; }
      if (effIds.has(id)) errs.push(`layer ${l.id}: two effects with id "${id}"; give one an id`);
      effIds.add(id);
      for (const k of Object.keys(e.params ?? {})) if (!def.params.some((s) => s.name === k)) errs.push(`layer ${l.id}: "${k}" is not a parameter of effect ${e.type}`);
    }
  }
  const targets = paramTargets(p);
  for (const lane of p.automation ?? []) {
    if (!targets.has(lane.target)) errs.push(`automation target "${lane.target}" doesn't exist`);
    for (const pt of lane.points) {
      if (pt.t === undefined && pt.bar === undefined) errs.push(`${lane.target}: a breakpoint needs t or bar`);
      if (pt.bar !== undefined && !p.grid) errs.push(`${lane.target}: breakpoints in bars need a tempo (song grid)`);
    }
  }
  for (const s of p.sections ?? []) if (s.bar !== undefined && !p.grid) errs.push(`section ${s.name}: bars need a tempo (song grid)`);
  for (const m of p.modulations ?? []) {
    if (!targets.has(m.target)) errs.push(`modulation target "${m.target}" doesn't exist`);
    if (!(m.source.split(".")[0]! in p.tracks)) errs.push(`modulation uses unknown track: ${m.source}`);
  }
  return errs;
}

/** Sections with their start times in seconds, in order. */
export function sectionTimes(p: Project): { t: number; name: string }[] {
  return (p.sections ?? []).map((s) => ({ t: positionToSeconds(s, p.grid), name: s.name })).sort((a, b) => a.t - b.t);
}

/** The video's range in seconds ([from, to)), clipped to [0, duration]. */
export function rangeSeconds(p: Project, duration: number): { from: number; to: number } {
  const from = p.range?.from !== undefined && p.grid ? positionToSeconds({ bar: p.range.from }, p.grid) : 0;
  const to = p.range?.to !== undefined && p.grid ? positionToSeconds({ bar: p.range.to }, p.grid) : duration;
  return { from: Math.max(0, from), to: Math.min(duration, to) };
}
