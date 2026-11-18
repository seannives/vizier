/**
 * Editing operations on the project files. Each changes a draft `Doc` (inside Session.apply) and always writes to
 * the open video's own file: in a video that builds on another, changing an inherited layer writes an override
 * (only what changed) to this video, and the base is never touched.
 */
import {
  resolveVideo, GENERATORS, EFFECTS, LAYER_PARAMS, type VideoFile, type VideoLayer, type LayerDef, type EffectRef, type Span, splitSpans, type LaneInput, type BreakpointInput, type Modulation, layoutFor, type LayoutFamily, type Transform,
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
  // a field set to undefined is removed: JSON (the saved file) can't hold undefined, so keeping the key would make
  // the editor and the saved file disagree
  for (const [k, v] of Object.entries(rest)) if (v === undefined) delete (e as unknown as Record<string, unknown>)[k];
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

/** A new id from a stem, unused anywhere in the project: by any video's layers, overrides or removals. Ids are
 *  shared between a video and the videos built on it, so a new layer in the base must never take the id of a
 *  reel's own layer (or of a layer a reel still overrides). */
function freshId(doc: Doc, _video: string, stem: string): string {
  const used = new Set(Object.values(doc.videos).flatMap((v) => (v.layers ?? []).map((l) => l.id)));
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

/** Layer parameters that, when set, override the layout (they're for automation). */
export const LAYOUT_PARAMS = ["x", "y", "w", "h", "rotation"];
/** Parameters the layer panel offers: the layer's own (opacity, hue, lightness) then the generator's. Position,
 *  size and rotation are the layout: dragged on the preview, or typed in the panel's Layout section. */
export const PANEL_LAYER_PARAMS = LAYER_PARAMS.filter((s) => !LAYOUT_PARAMS.includes(s.name));

/** Where the layer is in a layout family, as drawn: its layout (falling back like the renderer: feed → portrait →
 *  landscape), with any fixed x/y/w/h/rotation parameter on top. */
export function placement(layer: LayerDef, family: LayoutFamily): Transform {
  let base: Transform;
  try { base = layoutFor(layer, family); } catch { base = { ...FULL_FRAME }; }
  const p = layer.params ?? {};
  return { x: p.x ?? base.x, y: p.y ?? base.y, w: p.w ?? base.w, h: p.h ?? base.h, rotation: p.rotation ?? base.rotation ?? 0 };
}

/** Set where a layer is in one layout family (the other families keep theirs). Fixed layout parameters on the
 *  layer itself are cleared, so the layout is what you see. */
export function setLayout(doc: Doc, video: string, id: string, family: LayoutFamily, t: Transform): void {
  const r = (n: number) => Math.round(n * 10000) / 10000;
  const tr: Transform = { x: r(t.x), y: r(t.y), w: r(t.w), h: r(t.h) };
  if (t.rotation) tr.rotation = Math.round(t.rotation * 100) / 100;
  const e = ownEntry(doc, video, id);
  e.layout = { ...e.layout, [family]: tr };
  if (e.params) {
    for (const k of LAYOUT_PARAMS) delete e.params[k];
    if (!Object.keys(e.params).length) delete e.params;
  }
}
/** Whether the layer has a layout of its own for this family (otherwise it borrows another family's). */
export const hasOwnLayout = (layer: LayerDef, family: LayoutFamily) => !!layer.layout[family];
export const effectList = () => Object.values(EFFECTS);
export const generatorList = () => Object.values(GENERATORS);

/** A copy of a layer, just behind it (below it in the list, as in Ableton), with its own id; its automation and
 *  modulations are copied too. Returns the new id. */
export function duplicateLayer(doc: Doc, video: string, id: string): string {
  const src = layerOf(doc, video, id);
  if (!src) throw new Error(`No layer "${id}"`);
  const { id: _id, z, ...rest } = structuredClone(src);
  const behind = layersOf(doc, video).map((l) => l.z).filter((n) => n < z).sort((a, b) => b - a)[0];
  const newZ = behind === undefined ? z - 1 : (z + behind) / 2;
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

// ---- videos that build on others: what's inherited, what's changed here, and going back ----

/** How a layer relates to the video's base: added in this video, inherited unchanged, or inherited and changed here. */
export type LayerOrigin = "own" | "inherited" | "changed";
export function layerOrigin(doc: Doc, video: string, id: string): LayerOrigin {
  if (!isInherited(doc, video, id)) return "own";
  const e = doc.videos[video]?.layers?.find((l) => l.id === id && !l.remove);
  return e && Object.keys(e).some((k) => k !== "id") ? "changed" : "inherited";
}
/** The layer as the base video has it (undefined for a layer added here). */
export function baseLayer(doc: Doc, video: string, id: string): LayerDef | undefined {
  const base = doc.videos[video]?.base;
  return base ? layerOf(doc, base, id) : undefined;
}

/** A setting of an inherited layer that can be changed here and reset: a field, a parameter, or one shape's layout. */
export type Setting = { field: "generator" | "track" | "blend" | "text" | "effects" | "spans" | "name" | "z" | "opacity" | "colors" }
  | { param: string } | { layout: LayoutFamily };

/** Whether this video changes the setting of an inherited layer (false for layers added here: nothing to go back to). */
export function isChanged(doc: Doc, video: string, id: string, s: Setting): boolean {
  if (!isInherited(doc, video, id)) return false;
  const e = doc.videos[video]?.layers?.find((l) => l.id === id && !l.remove);
  if (!e) return false;
  if ("param" in s) return e.params?.[s.param] !== undefined;
  if ("layout" in s) return e.layout?.[s.layout] !== undefined;
  return (e as unknown as Record<string, unknown>)[s.field] !== undefined;
}

/** Go back to the base's value for one setting of an inherited layer. */
export function resetSetting(doc: Doc, video: string, id: string, s: Setting): void {
  const v = doc.videos[video]!;
  const e = v.layers?.find((l) => l.id === id && !l.remove);
  if (!e) return;
  if ("param" in s) { if (e.params) { delete e.params[s.param]; if (!Object.keys(e.params).length) delete e.params; } }
  else if ("layout" in s) { if (e.layout) { delete e.layout[s.layout]; if (!Object.keys(e.layout).length) delete e.layout; } }
  else delete (e as unknown as Record<string, unknown>)[s.field];
  if (Object.keys(e).length === 1) { v.layers = v.layers!.filter((l) => l !== e); if (!v.layers.length) delete v.layers; }
}

/** Drop every change this video makes to an inherited layer: it's the base's again. */
export function resetLayer(doc: Doc, video: string, id: string): void {
  const v = doc.videos[video]!;
  if (!isInherited(doc, video, id)) return;
  v.layers = (v.layers ?? []).filter((l) => l.id !== id || l.remove);
  if (!v.layers.length) delete v.layers;
}

/** Layers of the base that this video removes. */
export function removedLayers(doc: Doc, video: string): LayerDef[] {
  const v = doc.videos[video];
  if (!v?.base) return [];
  const gone = new Set((v.layers ?? []).filter((l) => l.remove).map((l) => l.id));
  return layersOf(doc, v.base).filter((l) => gone.has(l.id));
}

/** Bring back a base layer this video removed, with the base's automation and modulations for it. */
export function restoreLayer(doc: Doc, video: string, id: string): void {
  const v = doc.videos[video]!;
  v.layers = (v.layers ?? []).filter((l) => !(l.id === id && l.remove));
  if (!v.layers.length) delete v.layers;
  const mine = (t: string) => t.startsWith(`${id}.`);
  if (v.automation) { v.automation = v.automation.filter((a) => !(mine(a.target) && a.points.length === 0)); if (!v.automation.length) delete v.automation; }
  if (v.modulations) { v.modulations = v.modulations.filter((m) => !(mine(m.target) && m.remove)); if (!v.modulations.length) delete v.modulations; }
}

// ---- video settings and actions ----

/** Video ids are file names: letters, digits, - and _. */
export function videoId(doc: Doc, name: string): string {
  const stem = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "video";
  if (!doc.videos[stem]) return stem;
  let n = 2;
  while (doc.videos[`${stem}-${n}`]) n++;
  return `${stem}-${n}`;
}
const SCHEMA = "../../../packages/core/schema/video.schema.json";

/** A new video: blank (no layers), building on another video, or an independent copy of one (its base flattened
 *  in). Returns its id. */
export function newVideo(doc: Doc, opts: { name: string; format: string; from?: { video: string; how: "base" | "copy" } }): string {
  const id = videoId(doc, opts.name);
  let v: VideoFile;
  if (opts.from?.how === "base") v = { version: 2, name: opts.name, base: opts.from.video, format: opts.format };
  else if (opts.from?.how === "copy") v = { ...flattened(doc, opts.from.video), name: opts.name, format: opts.format };
  else v = { version: 2, name: opts.name, format: opts.format, layers: [] };
  doc.videos[id] = { $schema: SCHEMA, ...v } as VideoFile;
  return id;
}
/** The video with its base merged in: an independent file that looks exactly the same. */
function flattened(doc: Doc, video: string): VideoFile {
  const r = structuredClone(resolved(doc, video));
  delete r.base;
  delete r.profiles;
  r.layers = (r.layers ?? []).filter((l) => !l.remove);
  if (!r.automation?.length) delete r.automation;
  if (!r.modulations?.length) delete r.modulations;
  return r;
}
/** Make a video independent of its base: everything it inherited is copied in, so it looks the same. */
export function detachVideo(doc: Doc, video: string): void {
  const own = doc.videos[video]!;
  if (!own.base) return;
  const flat = flattened(doc, video);
  doc.videos[video] = { ...flat, name: own.name ?? flat.name, format: own.format ?? flat.format };
}
/** Change a video's own settings (name, format, range); `undefined` removes the setting (inherit / default). */
export function setVideo(doc: Doc, video: string, patch: Partial<Pick<VideoFile, "name" | "format" | "range">>): void {
  const v = doc.videos[video]!;
  for (const [k, val] of Object.entries(patch)) {
    if (val === undefined) delete (v as unknown as Record<string, unknown>)[k];
    else (v as unknown as Record<string, unknown>)[k] = val;
  }
  if (patch.format !== undefined) delete v.profiles;
}

// ---- automation lanes (number lanes; colour lanes come with the colour tools) ----

/** The lane the video uses for a target (inherited or its own), or undefined. */
export function laneOf(doc: Doc, video: string, target: string): LaneInput | undefined {
  return resolved(doc, video).automation?.find((a) => a.target === target && a.points.length > 0);
}
/** Whether this video has its own version of a lane its base also has (↺ goes back to the base's). */
export function laneChanged(doc: Doc, video: string, target: string): boolean {
  const v = doc.videos[video]!;
  if (!v.base) return false;
  const own = v.automation?.some((a) => a.target === target && a.points.length > 0);
  return !!own && !!laneOf(doc, v.base, target);
}
/** Whether the lane comes from the base unchanged. */
export function laneInherited(doc: Doc, video: string, target: string): boolean {
  const v = doc.videos[video]!;
  return !!v.base && !v.automation?.some((a) => a.target === target) && !!laneOf(doc, v.base, target);
}
/** Replace a lane's points (written to the open video; in a video with a base, this lane becomes its own). */
export function setLane(doc: Doc, video: string, target: string, points: BreakpointInput[]): void {
  const v = doc.videos[video]!;
  const sorted = [...points].sort((a, b) => (a.bar ?? a.t ?? 0) - (b.bar ?? b.t ?? 0));
  const list = (v.automation ??= []);
  const i = list.findIndex((a) => a.target === target);
  if (i >= 0) list[i] = { target, points: sorted }; else list.push({ target, points: sorted });
}
/** Start a lane with one breakpoint (the lane then holds that value until more points are added). */
export function addLane(doc: Doc, video: string, target: string, at: { bar?: number; t?: number }, v: number): void {
  if (laneOf(doc, video, target)) return;
  setLane(doc, video, target, [{ ...at, v }]);
}
/** Remove a lane. In a video with a base that has the lane, an empty lane here cancels it. */
export function removeLane(doc: Doc, video: string, target: string): void {
  const v = doc.videos[video]!;
  v.automation = (v.automation ?? []).filter((a) => a.target !== target);
  if (v.base && laneOf(doc, v.base, target)) v.automation.push({ target, points: [] });
  if (!v.automation.length) delete v.automation;
}
/** Back to the base's lane (drop this video's version, or its removal). */
export function resetLane(doc: Doc, video: string, target: string): void {
  const v = doc.videos[video]!;
  if (!v.automation) return;
  v.automation = v.automation.filter((a) => a.target !== target);
  if (!v.automation.length) delete v.automation;
}
/** The lanes aimed at a layer (its own parameters and its effects'), in a stable order. */
export function lanesOfLayer(doc: Doc, video: string, layerId: string): LaneInput[] {
  return (resolved(doc, video).automation ?? []).filter((a) => a.points.length > 0 && a.target.startsWith(`${layerId}.`) && !a.points.some((p) => p.c !== undefined));
}

// ---- audio modulation: target += amount × curve(feature of a track) ----

const modKey = (m: { target: string; source: string }) => `${m.target}<-${m.source}`;
/** The modulations the video applies to a target (inherited or its own). */
export function modsOf(doc: Doc, video: string, target: string): Modulation[] {
  return (resolved(doc, video).modulations ?? []).filter((m) => m.target === target && !m.remove);
}
/** How a modulation relates to the base: added here, inherited unchanged, or changed here. */
export function modOrigin(doc: Doc, video: string, m: { target: string; source: string }): "own" | "base" | "changed" {
  const v = doc.videos[video]!;
  const inBase = !!v.base && modsOf(doc, v.base, m.target).some((b) => b.source === m.source);
  if (!inBase) return "own";
  return v.modulations?.some((o) => modKey(o) === modKey(m) && !o.remove) ? "changed" : "base";
}
/** Add a modulation (a track's feature driving the target). Returns false if that source already drives it. */
export function addMod(doc: Doc, video: string, m: Modulation): boolean {
  if (modsOf(doc, video, m.target).some((o) => o.source === m.source)) return false;
  const v = doc.videos[video]!;
  // a base modulation this video removed: replace the removal
  v.modulations = (v.modulations ?? []).filter((o) => modKey(o) !== modKey(m));
  v.modulations.push(clean(m));
  return true;
}
const clean = (m: Modulation): Modulation => ({ target: m.target, source: m.source, amount: m.amount, ...(m.curve && m.curve !== "linear" ? { curve: m.curve } : {}) });
/** Change a modulation (identified by its current source). Changing the source replaces it with a new one. */
export function setMod(doc: Doc, video: string, target: string, source: string, next: Modulation): void {
  const v = doc.videos[video]!;
  if (next.source !== source) {
    if (modsOf(doc, video, target).some((o) => o.source === next.source)) return; // that source already drives it
    removeMod(doc, video, target, source);
    addMod(doc, video, next);
    return;
  }
  const list = (v.modulations ??= []);
  const i = list.findIndex((o) => o.target === target && o.source === source);
  if (i >= 0) list[i] = clean(next); else list.push(clean(next));
}
/** Remove a modulation; in a video with a base that has it, a `remove` entry cancels it here. */
export function removeMod(doc: Doc, video: string, target: string, source: string): void {
  const v = doc.videos[video]!;
  v.modulations = (v.modulations ?? []).filter((o) => !(o.target === target && o.source === source));
  if (v.base && modsOf(doc, v.base, target).some((b) => b.source === source)) v.modulations.push({ target, source, amount: 0, remove: true });
  if (!v.modulations.length) delete v.modulations;
}
/** Back to the base's version of a modulation (drop this video's change or removal). */
export function resetMod(doc: Doc, video: string, target: string, source: string): void {
  const v = doc.videos[video]!;
  if (!v.modulations) return;
  v.modulations = v.modulations.filter((o) => !(o.target === target && o.source === source));
  if (!v.modulations.length) delete v.modulations;
}

/** Layers front first: the reverse of the renderer's drawing order (ascending z, ties in list order). */
export function frontToBack<T extends { z: number }>(layers: T[]): T[] {
  return layers.map((l, i) => ({ l, i })).sort((a, b) => b.l.z - a.l.z || b.i - a.i).map((x) => x.l);
}
