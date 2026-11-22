/**
 * The projects folder (projects/ in the repo): listing projects, and making a new one from a title and its audio.
 *
 * A new project is made in steps, since its audio arrives one file at a time: `beginProject` makes the folder
 * (marked as unfinished), `addProjectMedia` puts each file in its media/, and `finishProject` writes song.json
 * (with the tempo and bar 1 worked out from the mix, as a starting point) and an empty YouTube video. A folder
 * still marked unfinished is not a project: `discardProject` removes it.
 */
import { mkdirSync, writeFileSync, readdirSync, existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SongFile, VideoFile } from "../../../packages/core/src/index.ts";
import { analyze } from "../../offline/src/analyze.ts";
import { decodeMono, SAMPLE_RATE } from "../../offline/src/audio.ts";
import { safeName, isAudio, AUDIO_EXT } from "./media.ts";

const UNFINISHED = ".unfinished";

/** Projects in the folder (any folder with a song.json), by title. */
export function listProjects(root: string): { id: string; title: string }[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && existsSync(join(root, e.name, "song.json")) && !existsSync(join(root, e.name, UNFINISHED)))
    .map((e) => {
      let title = e.name;
      try { title = (JSON.parse(readFileSync(join(root, e.name, "song.json"), "utf8")) as SongFile).title || e.name; } catch { /* keep the folder name */ }
      return { id: e.name, title };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** A folder name from a title ("The Maleficus!" → "the-maleficus"), not used yet. */
export function projectIdFor(root: string, title: string): string {
  const base = title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  if (!existsSync(join(root, base))) return base;
  for (let i = 2; ; i++) if (!existsSync(join(root, `${base}-${i}`))) return `${base}-${i}`;
}

const folder = (root: string, id: string) => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`bad project id ${id}`);
  return join(root, id);
};

export function beginProject(root: string, title: string): string {
  if (!title.trim()) throw new Error("a project needs a title");
  const id = projectIdFor(root, title.trim());
  const dir = folder(root, id);
  mkdirSync(join(dir, "media"), { recursive: true });
  mkdirSync(join(dir, "videos"));
  writeFileSync(join(dir, UNFINISHED), title.trim());
  return id;
}

/** Put a file in an unfinished project's media/ (under its own name, made safe and unique). */
export function addProjectMedia(root: string, id: string, name: string, bytes: Uint8Array): string {
  const dir = folder(root, id);
  if (!existsSync(join(dir, UNFINISHED))) throw new Error(`${id} isn't a project being made`);
  let n = safeName(name);
  if (!isAudio(n)) throw new Error(`${name} isn't an audio file vizier reads (${AUDIO_EXT.join(", ")})`);
  const ext = n.slice(n.lastIndexOf(".")), stem = n.slice(0, n.lastIndexOf("."));
  for (let i = 2; existsSync(join(dir, "media", n)); i++) n = `${stem}-${i}${ext}`;
  writeFileSync(join(dir, "media", n), bytes);
  return `media/${n}`;
}

const trackName = (file: string) => file.split("/").pop()!.replace(/\.[A-Za-z0-9]+$/, "");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "track";

/**
 * Write the song (the mix first, then the stems in the order given; tempo and bar 1 from the mix) and an empty
 * YouTube video. Returns the project folder.
 */
export function finishProject(root: string, id: string, mix: string, stems: string[]): { dir: string; song: SongFile } {
  const dir = folder(root, id);
  if (!existsSync(join(dir, UNFINISHED))) throw new Error(`${id} isn't a project being made`);
  for (const f of [mix, ...stems]) if (!/^media\/[^/]+$/.test(f) || !existsSync(join(dir, f))) throw new Error(`no ${f} in ${id}`);
  const title = readFileSync(join(dir, UNFINISHED), "utf8");
  // a first guess at the grid, from the mix (the tempo panel is where it's checked and set)
  let grid: SongFile["grid"] = { tempo: [{ bar: 1, bpm: 120, beatsPerBar: 4 }], downbeat: 0 };
  try {
    const a = analyze([{ id: "mix", samples: decodeMono(join(dir, mix)) }], "mix", SAMPLE_RATE);
    grid = { tempo: [{ bar: 1, bpm: a.bpm, beatsPerBar: a.beatsPerBar }], downbeat: Math.round(a.downbeat * 1000) / 1000 };
  } catch { /* keep the default */ }
  const ids = new Set(["mix"]);
  const tracks: SongFile["tracks"] = [{ id: "mix", name: "Mix", file: mix, mix: true }];
  for (const f of stems) {
    let tid = slug(trackName(f));
    for (let i = 2; ids.has(tid); i++) tid = `${slug(trackName(f))}-${i}`;
    ids.add(tid);
    tracks.push({ id: tid, name: trackName(f), file: f });
  }
  const song = { $schema: "../../packages/core/schema/song.schema.json", version: 2, title, tracks, grid } as SongFile;
  const video = { $schema: "../../../packages/core/schema/video.schema.json", version: 2, name: "YouTube (full song)", format: "youtube", layers: [] } as VideoFile;
  writeFileSync(join(dir, "song.json"), JSON.stringify(song, null, 2) + "\n");
  writeFileSync(join(dir, "videos", "youtube-full.json"), JSON.stringify(video, null, 2) + "\n");
  rmSync(join(dir, UNFINISHED));
  return { dir, song };
}

/** Remove a project that was never finished (nothing else). */
export function discardProject(root: string, id: string) {
  const dir = folder(root, id);
  if (existsSync(join(dir, UNFINISHED))) rmSync(dir, { recursive: true, force: true });
}
