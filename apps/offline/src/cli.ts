#!/usr/bin/env node
/**
 * Render a video of a project.
 *   pnpm render projects/the-maleficus --video youtube-full            # the video's own range and format
 *   pnpm render projects/the-maleficus --video youtube-full --profile reels --bars 81-97
 *   pnpm render projects/the-maleficus --video youtube-full --still-bar 105
 *   pnpm render projects/the-maleficus --video youtube-full --bench 300
 * Output: projects/<id>/output/<video>-<profile>[-b<from>-<to>].mp4 (replaced on re-render; --keep adds a
 * timestamp) plus a .json snapshot of exactly what was rendered.
 */
import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getProfile, validateProject, rangeSeconds, positionToSeconds, videoFormat } from "../../../packages/core/src/index.ts";
import { loadFeatures } from "./audio.ts";
import { openRenderer } from "./browser.ts";
import { startEncoder, startMuxer, probeVideo } from "./encode.ts";
import { loadProject } from "./project-io.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    video: { type: "string" },
    profile: { type: "string" },
    bars: { type: "string" },
    start: { type: "string" },
    duration: { type: "string" },
    still: { type: "string" },
    "still-bar": { type: "string" },
    bench: { type: "string" },
    keep: { type: "boolean", default: false },
    out: { type: "string" },
    gpu: { type: "boolean", default: false },
    encoder: { type: "string", default: "webcodecs" },
    bitrate: { type: "string" },
  },
});

if (!positionals[0]) die("usage: pnpm render <project folder> [--video name] [--profile id] [--bars 81-97] [--keep] [--gpu]");
let lp;
try { lp = loadProject(positionals[0], values.video); } catch (e) { die((e as Error).message); }
const { project } = lp;
const errs = validateProject(project);
if (errs.length) die(`Problems in ${lp.id}/${lp.videoName}:\n  ` + errs.join("\n  "));
const profile = getProfile(values.profile ?? videoFormat(lp.video) ?? "youtube");

const t0 = Date.now();
const tracks = await loadFeatures(project.tracks, profile.fps, join(lp.cacheDir, "features"));
const totalFrames = Math.min(...Object.values(tracks).map((t) => t.frameCount));
log(`${lp.id} / ${lp.videoName} · ${profile.label} · features ready (${Object.keys(tracks).join(", ")}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// Range: --bars, else --start/--duration (seconds), else the video's own range, else the whole song.
let rangeTag = "";
let fromSec: number, toSec: number;
const duration = totalFrames / profile.fps;
if (values.bars) {
  const m = /^(-?[\d.]+)-(-?[\d.]+)$/.exec(values.bars);
  if (!m || !project.grid) die("--bars needs the form 81-97 and a tempo in song.json");
  fromSec = positionToSeconds({ bar: Number(m[1]) }, project.grid);
  toSec = positionToSeconds({ bar: Number(m[2]) }, project.grid);
  rangeTag = `-b${m[1]}-${m[2]}`;
} else if (values.start !== undefined || values.duration !== undefined) {
  fromSec = Number(values.start ?? 0);
  toSec = values.duration ? fromSec + Number(values.duration) : duration;
  rangeTag = `-s${values.start ?? 0}-${values.duration ?? "end"}`;
} else {
  ({ from: fromSec, to: toSec } = rangeSeconds(project, duration));
}
const start = Math.max(0, Math.round(fromSec * profile.fps));
const end = Math.min(totalFrames, Math.round(toSec * profile.fps));
if (end <= start) die(`Nothing to render: the range is empty (${fromSec.toFixed(2)}–${toSec.toFixed(2)} s)`);

const localStamp = () => {
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
mkdirSync(lp.outputDir, { recursive: true });
const outPath = (base: string, ext: string) => {
  if (values.out) return values.out;
  let name = values.keep ? `${base}-${localStamp()}` : base;
  if (values.keep) for (let i = 2; existsSync(join(lp.outputDir, `${name}${ext}`)); i++) name = `${base}-${localStamp()}-${i}`;
  return join(lp.outputDir, `${name}${ext}`);
};

const r = await openRenderer(project, profile.id, tracks, { gpu: values.gpu! });
try {
  if (values.bench !== undefined) {
    const count = Number(values.bench) || 300;
    const b = await r.bench(start, Math.min(count, end - start));
    const pct = (ms: number, fps: number) => `${((ms / (1000 / fps)) * 100).toFixed(0)}%`;
    log(`render only (no readback, no encoding), ${profile.width}x${profile.height}, ${values.gpu ? "GPU" : "software GL"}, ${b.frames} frames:`);
    log(`  avg ${b.avgMs.toFixed(1)} ms · p95 ${b.p95Ms.toFixed(1)} · p99 ${b.p99Ms.toFixed(1)} · worst ${b.maxMs.toFixed(1)} ms per frame`);
    log(`  p99 uses ${pct(b.p99Ms, 30)} of the 30 fps budget (33.3 ms), ${pct(b.p99Ms, 60)} of the 60 fps budget (16.7 ms)`);
    log(`  frames over budget: ${b.over60} over 16.7 ms (would drop at 60 fps), ${b.over30} over 33.3 ms (would drop at 30 fps)`);
    log(`  slowest frames: ${b.worst.map((w) => `#${w.frame} ${w.ms.toFixed(1)} ms`).join(", ")}`);
    log(`  per layer (draw + upload, avg ms): ${Object.entries(b.layersMs).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(" · ")}`);
  } else if (values.still !== undefined || values["still-bar"] !== undefined) {
    const frame = values["still-bar"] !== undefined
      ? Math.round(positionToSeconds({ bar: Number(values["still-bar"]) }, project.grid) * profile.fps)
      : Number(values.still);
    const tag = values["still-bar"] !== undefined ? `bar${values["still-bar"]}` : `f${frame}`;
    const out = outPath(`${lp.videoName}-${profile.id}-${tag}`, ".png");
    const enc = startEncoder({ out, width: profile.width, height: profile.height, fps: profile.fps, still: true });
    await enc.write(await r.frame(frame));
    await enc.finish();
    log(`wrote ${relative(process.cwd(), out)}`);
  } else {
    const out = outPath(`${lp.videoName}-${profile.id}${rangeTag}`, ".mp4");
    const media = { out, fps: profile.fps, audio: project.tracks[project.mix], audioStart: start / profile.fps, duration: (end - start) / profile.fps };
    const bitrateMbps = Number(values.bitrate ?? profile.videoBitrateMbps * 1.5);
    let mode = values.encoder === "ffmpeg" ? "ffmpeg" : "webcodecs";
    let info = null as Awaited<ReturnType<typeof r.encodeStart>> | null;
    if (mode === "webcodecs") {
      try { info = await r.encodeStart(bitrateMbps); }
      catch (e) { log(`in-browser encoding unavailable (${(e as Error).message}); falling back to ffmpeg`); mode = "ffmpeg"; }
    }
    log(mode === "webcodecs"
      ? `encoding in Chrome: ${info!.codec}, ${info!.bitrateMbps} Mbps, hardware ${info!.hardware === true ? "yes" : info!.hardware === false ? "no" : "if available"}`
      : `encoding with ffmpeg (libx264)`);
    const enc = mode === "webcodecs" ? startMuxer(media) : startEncoder({ ...media, width: profile.width, height: profile.height, bitrateMbps: profile.videoBitrateMbps });
    let lastLog = Date.now(), lastFrame = start, renderMs = 0, encodeMs = 0;
    const BATCH = mode === "webcodecs" ? Math.max(1, Math.round(profile.fps / 2)) : 1;
    for (let f = start; f < end; f += BATCH) {
      const n = Math.min(BATCH, end - f);
      const a = performance.now();
      const data = mode === "webcodecs" ? await r.encodeFrames(f, n, start) : await r.frame(f);
      const b = performance.now();
      await enc.write(data);
      renderMs += b - a; encodeMs += performance.now() - b;
      const now = Date.now(), last = f + n - 1;
      if (now - lastLog >= 5000 || last === end - 1) {
        const done = last - lastFrame + 1, rate = done / ((now - lastLog) / 1000);
        log(`frame ${last + 1 - start}/${end - start} · ${rate.toFixed(1)} fps · in Chrome ${(renderMs / done).toFixed(0)} ms/frame · ffmpeg wait ${(encodeMs / done).toFixed(0)} ms/frame · eta ${((end - last - 1) / rate / 60).toFixed(1)} min`);
        lastLog = now; lastFrame = last + 1; renderMs = encodeMs = 0;
      }
    }
    if (mode === "webcodecs") await enc.write(await r.encodeFinish());
    await enc.finish();
    const probe = probeVideo(out);
    const expectSec = (end - start) / profile.fps;
    if (probe.frames !== end - start || Math.abs(probe.duration - expectSec) > 1.5 / profile.fps || Math.abs(probe.fps - profile.fps) > 0.01)
      log(`WARNING: expected ${end - start} frames, ${expectSec.toFixed(2)} s at ${profile.fps} fps; file has ${probe.frames} frames, ${probe.duration.toFixed(2)} s at ${probe.fps.toFixed(2)} fps`);
    // Snapshot: exactly what was rendered, so it can be reproduced or compared later.
    writeFileSync(out.replace(/\.mp4$/, "") + ".json", JSON.stringify({
      renderedAt: new Date().toISOString(),
      vizier: versionInfo(),
      command: process.argv.slice(2),
      project: lp.id, video: lp.videoName, profile: profile.id,
      range: { fromSeconds: start / profile.fps, toSeconds: end / profile.fps, frames: end - start },
      encoder: mode === "webcodecs" ? info : "libx264",
      song: lp.song, resolvedVideo: lp.video,
    }, null, 2));
    log(`wrote ${relative(process.cwd(), out)} (${probe.frames} frames, ${probe.duration.toFixed(2)} s, ${probe.fps.toFixed(2)} fps) in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  }
} finally {
  await r.close();
}

function versionInfo() {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const git = spawnSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], { encoding: "utf8" });
  const dirty = spawnSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" });
  return { version: pkg.version ?? "0.0.0", commit: git.stdout.trim() || null, localChanges: !!dirty.stdout.trim() };
}
function log(s: string) { process.stderr.write(`[vizier] ${s}\n`); }
function die(s: string): never { process.stderr.write(s + "\n"); process.exit(1); }
