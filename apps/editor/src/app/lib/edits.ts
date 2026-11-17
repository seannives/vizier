/**
 * Editing operations on the project files. Each changes a draft `Doc` (inside Session.apply) and always writes to
 * the open video's own file: in a video that builds on another, changing an inherited layer writes an override
 * (only what changed) to this video, and the base is never touched.
 */
import {
  resolveVideo, GENERATORS, EFFECTS, LAYER_PARAMS, type VideoFile, type VideoLayer, type LayerDef, type EffectRef, type Span, splitSpans,
} from "../../../../../packages/core/src/index.ts";
import type { Doc } from "./session.ts";

const resolved = (doc: Doc, video: string): VideoFile => resolveVideo(video, (n) => {
  const v = doc.videos[n];
  if (!v) throw new Error(`No video "${n}"`);
  return v;
});
/** The layers the video shows (inherited ones included), as the renderer sees them. */
export const layersOf = (doc: Doc, video: string): LayerDef[] => (resolved(doc, video).layers ?? []).filter((l) => !l.remove) as LayerDef[];
export const layerOf = (doc: Doc, video: string, id: string): LayerDef | undefined => layersOf(doc, video).find((l) => l.id === id);

/** Whether the layer comes from the video's base (so editing it here writes an override). */
export function isInherited(doc: Doc, video: string, id: string): boolean {
  const base = doc.videos[video]?.base;
  return !!base && layersOf(doc, base).some((l) => l.id === id);
}

/** The video's own entry for a layer, created (as a bare override) if the layer is inherited. */
function ownEntry(doc: Doc, video: string, id: string): VideoLayer {
  const v = doc.videos[video]!;
  v.layers ??= [];
  let e = v.layers.find((l) => l.id === id && !l.remove);
  if (!e) {
    if (!layerOf(doc, video, id)) throw new Error(`No layer "${id}"`);
    e = { id };
    v.layers.push(e);
  }
  return e;
}

/** Change some of a layer's fields. `params` and `layout` merge key by key; everything else replaces. */
export function patchLayer(doc: Doc, video: string, id: string, patch: Partial<LayerDef>): void {
  const e = ownEntry(doc, video, id);
  const { params, layout, ...rest } = patch;
  Object.assign(e, rest);
  if (params) e.params = { ...e.params, ...params };
  if (layout) e.layout = { ...e.layout, ...layout };
}

export const setParam = (doc: Doc, video: string, id: string, name: string, value: number) => patchLayer(doc, video, id, { params: { [name]: value } });

/** The effect chain as a whole is the layer's own once changed (like any list, it replaces the base's). */
export function setEffects(doc: Doc, video: string, id: string, effects: EffectRef[]): void {
  patchLayer(doc, video, id, { effects });
}
export function setEffectParam(doc: Doc, video: string, id: string, index: number, name: string, value: number): void {
  const effects = structuredClone(layerOf(doc, video, id)?.effects ?? []);
  const e = effects[index];
  if (!e) return;
  e.params = { ...e.params, [name]: value };
  setEffects(doc, video, id, effects);
}
/** Add an effect at the end of the chain; gives it an id if the layer already has one of that type. */
export function addEffect(doc: Doc, video: string, id: string, type: string): void {
  const effects = structuredClone(layerOf(doc, video, id)?.effects ?? []);
  const ids = new Set(effects.map((e) => e.id ?? e.type));
  const ref: EffectRef = { type };
  if (ids.has(type)) { let n = 2; while (ids.has(`${type}${n}`)) n++; ref.id = `${type}${n}`; }
  effects.push(ref);
  setEffects(doc, video, id, effects);
}
export function removeEffect(doc: Doc, video: string, id: string, index: number): void {
  const effects = structuredClone(layerOf(doc, video, id)?.effects ?? []);
  const [gone] = effects.splice(index, 1);
  if (!gone) return;
  setEffects(doc, video, id, effects);
  dropTargets(doc, video, `${id}.${gone.id ?? gone.type}.`);
}
export function moveEffect(doc: Doc, video: string, id: string, index: number, dir: -1 | 1): void {
  const effects = structuredClone(layerOf(doc, video, id)?.effects ?? []);
  const j = index + dir;
  if (j < 0 || j >= effects.length) return;
  [effects[index], effects[j]] = [effects[j]!, effects[index]!];
  setEffects(doc, video, id, effects);
}

/** A new id from a stem, unused by any layer of the video (inherited or removed ones too). */
function freshId(doc: Doc, video: string, stem: string): string {
  const used = new Set([...(resolved(doc, video).layers ?? []).map((l) => l.id), ...(doc.videos[video]!.layers ?? []).map((l) => l.id)]);
  const base = stem.replace(/[^A-Za-z0-9_-]/g, "").replace(/^[^A-Za-z0-9]+/, "") || "layer";
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

const FULL_FRAME = { x: 0.5, y: 0.5, w: 1, h: 1 };

/** Add a layer on top (full frame in every format). Returns its id. */
export function addLayer(doc: Doc, video: string, generator: string, track?: string, extra: Partial<LayerDef> = {}): string {
  const gen = GENERATORS[generator];
  if (!gen) throw new Error(`Unknown generator ${generator}`);
  const id = freshId(doc, video, generator);
  const z = Math.max(-1, ...layersOf(doc, video).map((l) => l.z)) + 1;
  const layer: VideoLayer = { id, name: gen.label, generator, z, layout: { landscape: { ...FULL_FRAME }, portrait: { ...FULL_FRAME } }, ...extra };
  if (track) layer.track = track;
  if (gen.kind === "canvas2d" && gen.usesText && layer.text === undefined) layer.text = "Text";
  const v = doc.videos[video]!;
  (v.layers ??= []).push(layer);
  return id;
}

/** Automation lanes and modulations aimed at `prefix…` go too: they'd point at nothing. In a video with a base,
 *  the base's are cancelled here (an empty lane, a `remove` modulation). */
function dropTargets(doc: Doc, video: string, prefix: string): void {
  const v = doc.videos[video]!;
  v.automation = (v.automation ?? []).filter((a) => !a.target.startsWith(prefix));
  v.modulations = (v.modulations ?? []).filter((m) => !m.target.startsWith(prefix));
  if (v.base) {
    const base = resolved(doc, v.base);
    for (const a of base.automation ?? []) if (a.target.startsWith(prefix)) v.automation.push({ target: a.target, points: [] });
    for (const m of base.modulations ?? []) if (m.target.startsWith(prefix)) v.modulations.push({ ...m, remove: true });
  }
  if (!v.automation.length) delete v.automation;
  if (!v.modulations.length) delete v.modulations;
}

export function removeLayer(doc: Doc, video: string, id: string): void {
  const v = doc.videos[video]!;
  const inherited = isInherited(doc, video, id);
  v.layers = (v.layers ?? []).filter((l) => l.id !== id);
  if (inherited) v.layers.push({ id, remove: true });
  if (!v.layers.length) delete v.layers;
  dropTargets(doc, video, `${id}.`);
}

/** Move a layer up (dir +1, in front) or down (−1, behind) one place: it swaps depth (z) with its neighbour. */
export function moveLayer(doc: Doc, video: string, id: string, dir: -1 | 1): void {
  const sorted = [...layersOf(doc, video)].sort((a, b) => a.z - b.z);
  const i = sorted.findIndex((l) => l.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) return;
  const a = sorted[i]!, b = sorted[j]!;
  let za = b.z, zb = a.z;
  if (za === zb) { za = a.z + dir * 0.5; } // same depth: just step past it
  patchLayer(doc, video, a.id, { z: za });
  patchLayer(doc, video, b.id, { z: zb });
}

/**
 * Change what draws a layer. Its own parameters and colours that the new generator doesn't have are dropped (with
 * their automation). An inherited layer can't change generator in place (the base's settings would no longer
 * fit), so it's replaced here by a new layer with the same name, track, depth, layout and spans. Returns the
 * layer's id (new in that case).
 */
export function setGenerator(doc: Doc, video: string, id: string, generator: string): string {
  const old = layerOf(doc, video, id);
  const gen = GENERATORS[generator];
  if (!old || !gen || old.generator === generator) return id;
  const keepParams = new Set([...LAYER_PARAMS, ...gen.params].map((s) => s.name));
  const keepColors = new Set((gen.colors ?? []).map((c) => c.name));
  const params = Object.fromEntries(Object.entries(old.params ?? {}).filter(([k]) => keepParams.has(k)));
  const colors = Object.fromEntries(Object.entries(old.colors ?? {}).filter(([k]) => keepColors.has(k)));
  if (isInherited(doc, video, id)) {
    const { id: _i, generator: _g, params: _p, colors: _c, ...rest } = old;
    removeLayer(doc, video, id);
    return addLayer(doc, video, generator, old.track, { ...structuredClone(rest), params, colors, name: old.name });
  }
  const e = ownEntry(doc, video, id);
  e.generator = generator;
  e.params = params;
  e.colors = colors;
  if (!Object.keys(params).length) delete e.params;
  if (!Object.keys(colors).length) delete e.colors;
  if (gen.kind === "canvas2d" && gen.usesText && e.text === undefined) e.text = "Text";
  const v = doc.videos[video]!;
  const gone = (target: string) => {
    if (!target.startsWith(`${id}.`)) return false;
    const rest = target.slice(id.length + 1);
    if (rest.includes(".")) return false; // an effect's parameter: unaffected
    return !keepParams.has(rest) && !keepColors.has(rest);
  };
  if (v.automation) { v.automation = v.automation.filter((a) => !gone(a.target)); if (!v.automation.length) delete v.automation; }
  if (v.modulations) { v.modulations = v.modulations.filter((m) => !gone(m.target)); if (!v.modulations.length) delete v.modulations; }
  return id;
}

/** When the layer is on. `null`: the whole song. */
export function setSpans(doc: Doc, video: string, id: string, spans: Span[] | null): void {
  const e = ownEntry(doc, video, id);
  const sorted = spans ? [...spans].sort((a, b) => a.from - b.from) : null;
  if (sorted && sorted.length) e.spans = sorted;
  // an inherited layer needs an explicit empty list to override the base's spans; otherwise just leave it out
  else if (isInherited(doc, video, id)) e.spans = [];
  else delete e.spans;
}

/** Parameters the layer panel offers: the layer's own (opacity, rotation, hue, lightness) then the generator's.
 *  Position and size are set by dragging on the preview (layout) rather than here. */
export const PANEL_LAYER_PARAMS = LAYER_PARAMS.filter((s) => !["x", "y", "w", "h"].includes(s.name));
export const effectList = () => Object.values(EFFECTS);
export const generatorList = () => Object.values(GENERATORS);

/** A copy of a layer, just in front of it, with its own id (and its automation and modulations copied too).
 *  Returns the new id. */
export function duplicateLayer(doc: Doc, video: string, id: string): string {
  const src = layerOf(doc, video, id);
  if (!src) throw new Error(`No layer "${id}"`);
  const { id: _id, z, ...rest } = structuredClone(src);
  const above = layersOf(doc, video).map((l) => l.z).filter((n) => n > z).sort((a, b) => a - b)[0];
  const newZ = above === undefined ? z + 1 : (z + above) / 2;
  const newId = addLayer(doc, video, src.generator, src.track, { ...rest, z: newZ, name: `${src.name ?? id} copy` });
  const all = resolved(doc, video);
  const v = doc.videos[video]!;
  for (const a of all.automation ?? []) if (a.target.startsWith(`${id}.`)) (v.automation ??= []).push({ ...structuredClone(a), target: newId + a.target.slice(id.length) });
  for (const m of all.modulations ?? []) if (m.target.startsWith(`${id}.`)) (v.modulations ??= []).push({ ...structuredClone(m), target: newId + m.target.slice(id.length) });
  return newId;
}

export const renameLayer = (doc: Doc, video: string, id: string, name: string) => patchLayer(doc, video, id, { name });

/** Split the layer's span at `bar` (a layer that's on for the whole song gets two spans: up to `bar`, and from it).
 *  `startBar`: the bar at the song's first moment (before bar 1 when the downbeat isn't at 0 s). False if there was
 *  nothing to split there. */
export function splitLayerAt(doc: Doc, video: string, id: string, bar: number, startBar: number): boolean {
  const cur = layerOf(doc, video, id)?.spans ?? [];
  const from = cur.length ? cur : [{ from: Math.min(1, Math.floor(startBar * 1000) / 1000) }];
  const next = splitSpans(from, Math.round(bar * 1000) / 1000);
  if (next.length === from.length) return false;
  setSpans(doc, video, id, next);
  return true;
}
