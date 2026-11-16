/**
 * File formats (version 2). A project folder holds one song and any number of videos:
 *
 *   projects/<id>/song.json         the facts about the song: tracks (stems), grid, sections, palette
 *   projects/<id>/videos/<name>.json one video: formats, bar range, layers, text, automation
 *
 * A video can build on another (`base`): it inherits everything and overrides or adds to it, so a Reel can
 * reuse the full video's look with its own bar range and text.
 */
import type { Grid } from "./grid.ts";
import type { LaneInput } from "./automation.ts";
import type { LayerDef, Modulation, Project, Section } from "./project.ts";

export interface TrackDef {
  id: string;        // fixed: referenced by layers and modulations; never changes when renamed
  name: string;      // display name
  file: string;      // audio file, relative to the project folder
  mix?: boolean;     // the track whose audio goes into the video (exactly one)
}

export interface SongFile {
  version: 2;
  title: string;
  artist?: string;
  release?: string;
  tracks: TrackDef[];
  grid?: Grid;
  sections?: Section[];
  palette?: Record<string, string>;
}

/** A layer in a video file. In a video with a `base`, a layer with an existing id overrides that layer's fields. */
export interface VideoLayer extends Partial<LayerDef> { id: string; remove?: boolean }

export interface VideoFile {
  version: 2;
  name?: string;
  base?: string;                  // another video in the same project to build on
  profiles?: string[];            // output formats; the first is the default
  range?: { from?: number; to?: number }; // bars; `to` is where it ends (exclusive): 17–49 = bars 17..48
  seed?: number;
  palette?: Record<string, string>; // overrides the song's
  layers?: VideoLayer[];
  automation?: LaneInput[];       // a lane replaces the base's lane for the same target
  modulations?: (Modulation & { remove?: boolean })[]; // replaces the base's entry with the same target + source
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Merge `child` over `base` (both already resolved). Arrays of layers/lanes/modulations merge by key. */
export function mergeVideos(base: VideoFile, child: VideoFile): VideoFile {
  const out: VideoFile = { ...base, ...child, base: undefined };
  // layers by id: deep-merge params and layout; effects replace; `remove` drops
  const layers = new Map<string, VideoLayer>((base.layers ?? []).map((l) => [l.id, l]));
  for (const l of child.layers ?? []) {
    if (l.remove) { layers.delete(l.id); continue; }
    const prev = layers.get(l.id);
    if (!prev) { layers.set(l.id, l); continue; }
    const merged: VideoLayer = { ...prev, ...l };
    if (isObj(prev.params) || isObj(l.params)) merged.params = { ...prev.params, ...l.params };
    if (isObj(prev.layout) || isObj(l.layout)) merged.layout = { ...prev.layout, ...l.layout };
    layers.set(l.id, merged);
  }
  out.layers = [...layers.values()];
  const lanes = new Map<string, LaneInput>((base.automation ?? []).map((a) => [a.target, a]));
  for (const a of child.automation ?? []) lanes.set(a.target, a);
  out.automation = [...lanes.values()].filter((a) => a.points.length > 0); // an empty lane removes the base's
  const key = (m: Modulation) => `${m.target}<-${m.source}`;
  const mods = new Map((base.modulations ?? []).map((m) => [key(m), m]));
  for (const m of child.modulations ?? []) { if (m.remove) mods.delete(key(m)); else mods.set(key(m), m); }
  out.modulations = [...mods.values()];
  if (base.palette || child.palette) out.palette = { ...base.palette, ...child.palette };
  return out;
}

/**
 * Resolve a video's `base` chain. `load(name)` returns a video file by name.
 * Throws on missing bases and on cycles.
 */
export function resolveVideo(name: string, load: (name: string) => VideoFile, seen: string[] = []): VideoFile {
  if (seen.includes(name)) throw new Error(`Videos build on each other in a loop: ${[...seen, name].join(" → ")}`);
  const v = load(name);
  if (!v.base) return v;
  return mergeVideos(resolveVideo(v.base, load, [...seen, name]), v);
}

/** The renderer's view of a song + resolved video. Track files are resolved by the caller (`trackPath`). */
export function buildProject(song: SongFile, video: VideoFile, trackPath: (t: TrackDef) => string): Project {
  const mix = song.tracks.find((t) => t.mix) ?? song.tracks[0];
  return {
    version: 2,
    title: song.title,
    seed: video.seed ?? 1,
    tracks: Object.fromEntries(song.tracks.map((t) => [t.id, trackPath(t)])),
    trackNames: Object.fromEntries(song.tracks.map((t) => [t.id, t.name])),
    mix: mix?.id ?? "",
    grid: song.grid,
    sections: song.sections,
    palette: { ...song.palette, ...video.palette },
    range: video.range,
    layers: (video.layers ?? []).filter((l) => !l.remove).map((l) => l as LayerDef),
    automation: video.automation ?? [],
    modulations: (video.modulations ?? []).filter((m) => !m.remove),
  };
}

export function validateSong(song: SongFile): string[] {
  const errs: string[] = [];
  if (song.version !== 2) errs.push("song.json: version must be 2");
  const ids = new Set<string>();
  for (const t of song.tracks ?? []) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(t.id)) errs.push(`track id "${t.id}": use lowercase letters, digits and hyphens`);
    if (ids.has(t.id)) errs.push(`two tracks with id "${t.id}"`);
    ids.add(t.id);
  }
  const mixes = (song.tracks ?? []).filter((t) => t.mix).length;
  if (mixes !== 1) errs.push(`song.json: exactly one track must be the mix (found ${mixes})`);
  return errs;
}
