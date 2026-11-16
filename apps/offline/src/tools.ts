#!/usr/bin/env node
/**
 *   pnpm validate projects/the-maleficus     check song.json and every video (schema + references + files)
 *   pnpm analyze projects/the-maleficus      tempo, bar 1, where tracks play, likely section changes
 *   pnpm analyze <folder of stems>           the same, for a folder that has no song.json yet
 *   options for analyze: --json, --bpm 155 (if the guess is off), --mix <track id or file name>
 */
import { parseArgs } from "node:util";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import AjvModule from "ajv";
const Ajv = (AjvModule as unknown as { default: typeof AjvModule }).default ?? AjvModule;
import { checkProject, listVideos, projectDir } from "./project-io.ts";
import { decodeMono, SAMPLE_RATE } from "./audio.ts";
import { analyze } from "./analyze.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { json: { type: "boolean", default: false }, bpm: { type: "string" }, mix: { type: "string" } },
});
const [cmd, target] = positionals;
if (!cmd || !target) die("usage: pnpm validate <project folder> | pnpm analyze <project folder or folder of stems>");
const root = fileURLToPath(new URL("../../../", import.meta.url));

if (cmd === "validate") {
  const dir = projectDir(target);
  const ajv = new (Ajv as unknown as new (o: object) => import("ajv").default)({ allErrors: true });
  const songSchema = ajv.compile(JSON.parse(readFileSync(join(root, "packages/core/schema/song.schema.json"), "utf8")));
  const videoSchema = ajv.compile(JSON.parse(readFileSync(join(root, "packages/core/schema/video.schema.json"), "utf8")));
  let problems = 0;
  const report = (what: string, errs: string[]) => {
    problems += errs.length;
    console.log(errs.length ? `✗ ${what}\n${errs.map((e) => `    ${e}`).join("\n")}` : `✓ ${what}`);
  };
  const schemaErrs = (fn: typeof songSchema) => (fn.errors ?? []).map((e: import("ajv").ErrorObject) => `${e.instancePath || "(top)"} ${e.message}${e.params && "additionalProperty" in e.params ? `: "${(e.params as { additionalProperty: string }).additionalProperty}"` : ""}`);
  if (!songSchema(JSON.parse(readFileSync(join(dir, "song.json"), "utf8")))) report("song.json (format)", schemaErrs(songSchema));
  for (const v of listVideos(dir)) if (!videoSchema(JSON.parse(readFileSync(join(dir, "videos", `${v}.json`), "utf8")))) report(`videos/${v}.json (format)`, schemaErrs(videoSchema));
  for (const r of checkProject(dir)) report(r.video === "(song)" ? "song.json" : `videos/${r.video}.json`, r.errors);
  if (problems) { console.log(`\n${problems} problem(s)`); process.exit(1); }
} else if (cmd === "analyze") {
  const dir = resolve(target);
  // tracks: from song.json if there is one, else every audio file in the folder (and its media/)
  let list: { id: string; file: string; mix?: boolean }[];
  if (existsSync(join(dir, "song.json"))) {
    list = JSON.parse(readFileSync(join(dir, "song.json"), "utf8")).tracks.map((t: { id: string; file: string; mix?: boolean }) => ({ ...t, file: resolve(dir, t.file) }));
  } else {
    const audio = (d: string) => existsSync(d) ? readdirSync(d).filter((f) => /\.(wav|aiff?|flac|mp3|m4a)$/i.test(f)).map((f) => join(d, f)) : [];
    list = [...audio(dir), ...audio(join(dir, "media"))].map((f) => ({ id: basename(f, extname(f)), file: f }));
    if (!list.length) die(`No song.json and no audio files in ${dir}`);
  }
  const mixId = values.mix ?? list.find((t) => t.mix)?.id
    ?? list.map((t) => t.id).find((id) => /mix|main|master|full/i.test(id)) ?? list[0]!.id;
  process.stderr.write(`[vizier] analysing ${list.length} track(s) (mix: ${mixId})…\n`);
  const a = analyze(list.map((t) => ({ id: t.id, samples: decodeMono(t.file) })), mixId, SAMPLE_RATE, { bpm: values.bpm ? Number(values.bpm) : undefined });
  if (values.json) { console.log(JSON.stringify(a, null, 2)); process.exit(0); }
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
  console.log(`duration      ${fmt(a.duration)}`);
  console.log(`tempo         ${a.bpm} BPM${values.bpm ? " (given)" : ""}   other candidates: ${a.tempo.slice(1).map((t) => `${t.bpm} (${t.score})`).join(", ")}`);
  console.log(`bar 1 starts  ${a.downbeat.toFixed(3)} s   (${a.bars} complete bars of ${a.beatsPerBar} beats)`);
  console.log(`\nwhere each track plays (bars; one character per 4 bars, louder = taller):`);
  const blocks = " ▁▂▃▄▅▆▇█";
  const w = Math.max(...a.tracks.map((t) => t.id.length));
  for (const t of a.tracks) {
    const spark = Array.from({ length: Math.ceil(t.levels.length / 4) }, (_, i) => {
      const seg = t.levels.slice(i * 4, i * 4 + 4); const v = Math.max(...seg);
      return blocks[Math.min(8, Math.max(0, Math.round((v - 0.2) / 0.6 * 8)))];
    }).join("");
    console.log(`  ${t.id.padEnd(w)}  ${spark}   ${t.active.map(([x, y]) => (x === y ? `${x}` : `${x}–${y}`)).join(", ")}`);
  }
  console.log(`\nlikely section changes (bar: strength): ${a.sectionChanges.map((c) => `${c.bar}: ${c.strength}`).join(", ") || "none found"}`);
  console.log(`\nsuggested grid for song.json:\n  "grid": { "tempo": [{ "bar": 1, "bpm": ${a.bpm}, "beatsPerBar": ${a.beatsPerBar} }], "downbeat": ${a.downbeat} }`);
} else die(`Unknown command ${cmd}`);

function die(s: string): never { process.stderr.write(s + "\n"); process.exit(1); }
