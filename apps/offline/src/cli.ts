#!/usr/bin/env node
/**
 * Offline driver: project + stems → MP4.
 *   pnpm render examples/ozgun-acid/project.json --profile youtube [--start 60 --duration 20] [--out out/x.mp4]
 *   pnpm render <project> --profile reels --still 1800 --out out/frame.png
 */
import { parseArgs } from "node:util";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { getProfile, validateProject, type Project } from "../../../packages/core/src/index.ts";
import { loadFeatures } from "./audio.ts";
import { openRenderer } from "./browser.ts";
import { startEncoder } from "./encode.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    profile: { type: "string", default: "youtube" },
    start: { type: "string", default: "0" },
    duration: { type: "string" },
    still: { type: "string" },
    out: { type: "string" },
    gpu: { type: "boolean", default: false },
  },
});

const projectPath = resolve(positionals[0] ?? die("usage: render <project.json> [--profile id]"));
const project: Project = JSON.parse(readFileSync(projectPath, "utf8"));
const errs = validateProject(project);
if (errs.length) die("Invalid project:\n  " + errs.join("\n  "));
const profile = getProfile(values.profile!);
const projectDir = dirname(projectPath);
const stemPaths = Object.fromEntries(Object.entries(project.stems).map(([k, v]) => [k, resolve(projectDir, v)]));

const t0 = Date.now();
const tracks = await loadFeatures(stemPaths, profile.fps);
const totalFrames = Math.min(...Object.values(tracks).map((t) => t.frameCount));
log(`features ready (${Object.keys(tracks).join(", ")}; ${totalFrames} frames) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const r = await openRenderer(project, profile.id, tracks, { gpu: values.gpu! });
try {
  if (values.still !== undefined) {
    const frame = Number(values.still);
    const out = resolve(values.out ?? `out/${basename(projectDir)}-${profile.id}-${frame}.png`);
    mkdirSync(dirname(out), { recursive: true });
    const enc = startEncoder({ out, width: profile.width, height: profile.height, fps: profile.fps, still: true });
    await enc.write(await r.frame(frame));
    await enc.finish();
    log(`wrote ${out}`);
  } else {
    const start = Math.round(Number(values.start) * profile.fps);
    const count = values.duration ? Math.round(Number(values.duration) * profile.fps) : totalFrames - start;
    const end = Math.min(totalFrames, start + count);
    const out = resolve(values.out ?? `out/${basename(projectDir)}-${profile.id}.mp4`);
    mkdirSync(dirname(out), { recursive: true });
    const enc = startEncoder({
      out, width: profile.width, height: profile.height, fps: profile.fps, bitrateMbps: profile.videoBitrateMbps,
      audio: stemPaths.main, audioStart: start / profile.fps, duration: (end - start) / profile.fps,
    });
    const tr = Date.now();
    for (let f = start; f < end; f++) {
      await enc.write(await r.frame(f));
      if ((f - start) % (profile.fps * 5) === 0) {
        const done = f - start + 1, rate = done / ((Date.now() - tr) / 1000);
        log(`frame ${f}/${end} · ${rate.toFixed(1)} fps · eta ${((end - f) / rate / 60).toFixed(1)} min`);
      }
    }
    await enc.finish();
    log(`wrote ${out} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  }
} finally {
  await r.close();
}

function log(s: string) { process.stderr.write(`[vizier] ${s}\n`); }
function die(s: string): never { process.stderr.write(s + "\n"); process.exit(1); }
