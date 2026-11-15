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
    bench: { type: "string" },
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
  if (values.bench !== undefined) {
    const count = Number(values.bench) || 300;
    const start = Math.round(Number(values.start) * profile.fps);
    const b = await r.bench(start, Math.min(count, totalFrames - start - 10));
    const pct = (ms: number, fps: number) => `${((ms / (1000 / fps)) * 100).toFixed(0)}%`;
    log(`render only (no readback, no encoding), ${profile.width}x${profile.height}, ${values.gpu ? "GPU" : "software GL"}, ${b.frames} frames:`);
    log(`  avg ${b.avgMs.toFixed(1)} ms · p95 ${b.p95Ms.toFixed(1)} · p99 ${b.p99Ms.toFixed(1)} · worst ${b.maxMs.toFixed(1)} ms per frame`);
    log(`  p99 uses ${pct(b.p99Ms, 30)} of the 30 fps budget (33.3 ms), ${pct(b.p99Ms, 60)} of the 60 fps budget (16.7 ms)`);
    log(`  frames over budget: ${b.over60} over 16.7 ms (would drop at 60 fps), ${b.over30} over 33.3 ms (would drop at 30 fps)`);
    log(`  slowest frames: ${b.worst.map((w) => `#${w.frame} ${w.ms.toFixed(1)} ms`).join(", ")}`);
    log(`  per layer (draw + upload, avg ms): ${Object.entries(b.layersMs).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(" · ")}`);
  } else if (values.still !== undefined) {
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
    const range = values.duration || Number(values.start) ? `-${values.start}s-${values.duration ?? "end"}` : "";
    const out = resolve(values.out ?? `out/${basename(projectDir)}-${profile.id}${range}.mp4`);
    mkdirSync(dirname(out), { recursive: true });
    const enc = startEncoder({
      out, width: profile.width, height: profile.height, fps: profile.fps, bitrateMbps: profile.videoBitrateMbps,
      audio: stemPaths.main, audioStart: start / profile.fps, duration: (end - start) / profile.fps,
    });
    // Progress every ~5 s of wall-clock time, with where the time went: rendering + reading pixels back
    // from the browser, versus waiting for ffmpeg to accept the frame.
    let lastLog = Date.now(), lastFrame = start, renderMs = 0, encodeMs = 0;
    for (let f = start; f < end; f++) {
      const a = performance.now();
      const px = await r.frame(f);
      const b = performance.now();
      await enc.write(px);
      renderMs += b - a; encodeMs += performance.now() - b;
      const now = Date.now();
      if (now - lastLog >= 5000 || f === end - 1) {
        const n = f - lastFrame + 1, rate = n / ((now - lastLog) / 1000);
        log(`frame ${f + 1}/${end} · ${rate.toFixed(1)} fps · render+readback ${(renderMs / n).toFixed(0)} ms/frame · encoder wait ${(encodeMs / n).toFixed(0)} ms/frame · eta ${((end - f - 1) / rate / 60).toFixed(1)} min`);
        lastLog = now; lastFrame = f + 1; renderMs = encodeMs = 0;
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
