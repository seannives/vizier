/** Reading project folders: projects/<id>/song.json + videos/<name>.json. */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  buildProject, resolveVideo, validateSong, validateProject,
  type Project, type SongFile, type VideoFile,
} from "../../../packages/core/src/index.ts";

export interface LoadedProject {
  dir: string;
  id: string;
  song: SongFile;
  videoName: string;
  video: VideoFile;       // resolved (base chain merged)
  project: Project;       // what the renderer uses
  cacheDir: string;
  outputDir: string;
}

const readJson = <T>(path: string): T => {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; }
  catch (e) { throw new Error(`Can't read ${path}: ${(e as Error).message}`); }
};

export function listVideos(dir: string): string[] {
  const v = join(dir, "videos");
  return existsSync(v) ? readdirSync(v).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort() : [];
}

/** Accepts a project folder (or a path to its song.json). */
export function projectDir(path: string): string {
  const p = resolve(path);
  if (existsSync(p) && statSync(p).isDirectory()) return p;
  if (basename(p) === "song.json") return resolve(p, "..");
  throw new Error(`${path} is not a project folder (expected a folder containing song.json)`);
}

export function loadSong(dir: string): SongFile {
  const file = join(dir, "song.json");
  if (!existsSync(file)) throw new Error(`No song.json in ${dir}`);
  return readJson<SongFile>(file);
}

export function loadVideoFile(dir: string, name: string): VideoFile {
  const file = join(dir, "videos", `${name}.json`);
  if (!existsSync(file)) throw new Error(`No video "${name}" in ${dir}/videos (have: ${listVideos(dir).join(", ") || "none"})`);
  return readJson<VideoFile>(file);
}

export function loadProject(path: string, videoName?: string): LoadedProject {
  const dir = projectDir(path);
  const song = loadSong(dir);
  const videos = listVideos(dir);
  const name = videoName ?? (videos.length === 1 ? videos[0]! : undefined);
  if (!name) throw new Error(`Choose a video with --video (have: ${videos.join(", ") || "none"})`);
  const video = resolveVideo(name, (n) => loadVideoFile(dir, n));
  const project = buildProject(song, video, (t) => resolve(dir, t.file));
  return { dir, id: basename(dir), song, videoName: name, video, project, cacheDir: join(dir, ".cache"), outputDir: join(dir, "output") };
}

/** All problems with a project folder: the song, and every video (resolved). */
export function checkProject(path: string): { video: string; errors: string[] }[] {
  const dir = projectDir(path);
  const out: { video: string; errors: string[] }[] = [];
  let song: SongFile;
  try { song = loadSong(dir); } catch (e) { return [{ video: "(song)", errors: [(e as Error).message] }]; }
  const songErrs = validateSong(song);
  for (const t of song.tracks ?? []) if (!existsSync(resolve(dir, t.file))) songErrs.push(`track "${t.id}": audio file ${t.file} not found`);
  out.push({ video: "(song)", errors: songErrs });
  for (const v of listVideos(dir)) {
    try { out.push({ video: v, errors: validateProject(loadProject(dir, v).project) }); }
    catch (e) { out.push({ video: v, errors: [(e as Error).message] }); }
  }
  return out;
}
