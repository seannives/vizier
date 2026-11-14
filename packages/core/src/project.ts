import { positionToSeconds, type LaneInput, type Tempo } from "./automation.ts";
import type { LayoutFamily } from "./profiles.ts";

/** Where a layer sits on the output canvas. Fractions of the canvas, centre-anchored. */
export interface Transform { x: number; y: number; w: number; h: number; rotation?: number }

export type BlendMode = "normal" | "add" | "screen" | "multiply";

export interface LayerDef {
  id: string;
  /** Which stem's features drive this layer by default (e.g. "bass"). */
  stem?: string;
  generator: string;
  z: number;
  opacity?: number;
  blend?: BlendMode;
  /** Render this layer at a fraction of its on-screen pixel size (cheap soft layers). */
  resolutionScale?: number;
  params?: Record<string, number>;
  text?: string;
  /** One transform per layout family; "feed" falls back to "portrait", then "landscape". */
  layout: Partial<Record<LayoutFamily, Transform>>;
}

/** Audio-to-parameter mapping: target += amount * feature (after curve). */
export interface Modulation {
  target: string;           // "layerId.param", e.g. "bass.radius"
  source: string;           // "stem.feature", e.g. "bass.env"
  amount: number;
  curve?: "linear" | "square" | "sqrt";
}

/** A section of the arrangement, placed in seconds (`t`) or bars (`bar`, 1-based). */
export interface Section { t?: number; bar?: number; name: string }

export interface Project {
  version: 1;
  title: string;
  seed: number;
  /** Needed for anything placed in bars. */
  tempo?: Tempo;
  /** Stem name → audio file path (relative to the project file). "main" is muxed into the video. */
  stems: Record<string, string>;
  palette: Record<string, string>;
  sections?: Section[];
  layers: LayerDef[];
  automation?: LaneInput[];
  modulations?: Modulation[];
}

export function layoutFor(layer: LayerDef, family: LayoutFamily): Transform {
  const order: LayoutFamily[] = family === "feed" ? ["feed", "portrait", "landscape"] : family === "portrait" ? ["portrait", "landscape"] : ["landscape", "portrait"];
  for (const f of order) { const t = layer.layout[f]; if (t) return t; }
  throw new Error(`Layer ${layer.id} has no layout`);
}

export function validateProject(p: Project): string[] {
  const errs: string[] = [];
  if (p.version !== 1) errs.push("version must be 1");
  const ids = new Set<string>();
  for (const l of p.layers) {
    if (ids.has(l.id)) errs.push(`duplicate layer id ${l.id}`);
    ids.add(l.id);
    if (!l.layout.landscape && !l.layout.portrait) errs.push(`layer ${l.id} needs a landscape or portrait layout`);
    if (l.stem && !(l.stem in p.stems)) errs.push(`layer ${l.id} uses unknown stem ${l.stem}`);
  }
  const targetOk = (t: string) => t.startsWith("post.") || ids.has(t.split(".")[0]!);
  for (const lane of p.automation ?? []) {
    if (!targetOk(lane.target)) errs.push(`automation targets unknown layer: ${lane.target}`);
    for (const pt of lane.points) {
      if (pt.t === undefined && pt.bar === undefined) errs.push(`${lane.target}: a breakpoint needs t or bar`);
      if (pt.bar !== undefined && !p.tempo) errs.push(`${lane.target}: breakpoints in bars need a project tempo`);
    }
  }
  for (const s of p.sections ?? []) if (s.bar !== undefined && !p.tempo) errs.push(`section ${s.name}: bars need a project tempo`);
  for (const m of p.modulations ?? []) {
    if (!targetOk(m.target)) errs.push(`modulation targets unknown layer: ${m.target}`);
    if (!(m.source.split(".")[0]! in p.stems)) errs.push(`modulation uses unknown stem: ${m.source}`);
  }
  return errs;
}

/** Sections with their start times in seconds, in order. */
export function sectionTimes(p: Project): { t: number; name: string }[] {
  return (p.sections ?? []).map((s) => ({ t: positionToSeconds(s, p.tempo), name: s.name })).sort((a, b) => a.t - b.t);
}
