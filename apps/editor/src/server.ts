#!/usr/bin/env node
/**
 * The editor: a local web app for a project folder.
 *   vizier editor projects/demo [--video full] [--port 5174] [--no-open]   opens http://localhost:5174 in a Chrome window of its own.
 * The server reads and writes the project's files; the page holds the session (project data + undo history).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, statSync, createReadStream, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import sveltePluginModule from "esbuild-svelte";
import type { Plugin } from "esbuild";
// esbuild-svelte is CommonJS; its default export is the plugin factory
const sveltePlugin = ((sveltePluginModule as unknown as { default?: unknown }).default ?? sveltePluginModule) as (o: object) => Plugin;
import { getProfile, buildProject, resolveVideo, videoFormat, type SongFile, type VideoFile } from "../../../packages/core/src/index.ts";
import { loadFeatures, decodeMono, SAMPLE_RATE } from "../../offline/src/audio.ts";
import { listVideos, loadSong, loadVideoFile, projectDir } from "../../offline/src/project-io.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    video: { type: "string" }, port: { type: "string", default: "5174" }, host: { type: "string", default: "127.0.0.1" },
    "no-open": { type: "boolean", default: false },
  },
});
if (!positionals[0]) die("usage: vizier editor <project folder> [--video name] [--port 5174] [--no-open]");
let dir: string;
try { dir = projectDir(positionals[0]); } catch (e) { die((e as Error).message); }
const song0 = loadSong(dir);
const trackPath = (file: string) => resolve(dir, file);

// ---- the app bundle (Svelte 5 + TypeScript), built at startup ----
log("building the editor…");
const t0 = Date.now();
const bundle = await build({
  entryPoints: [join(root, "apps/editor/src/app/main.ts")],
  bundle: true, write: false, format: "esm", target: "es2022", outdir: "out",
  tsconfig: join(root, "tsconfig.json"), logLevel: "error",
  mainFields: ["svelte", "browser", "module", "main"], conditions: ["svelte", "browser"],
  plugins: [sveltePlugin({ compilerOptions: { css: "injected" } })],
});
const appJs = bundle.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
log(`built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const fonts: Record<string, string> = {
  "special-elite.ttf": "assets/fonts/SpecialElite-Regular.ttf",
  "space-grotesk-400.woff2": "node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff2",
  "space-grotesk-500.woff2": "node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-500-normal.woff2",
  "jetbrains-mono-400.woff2": "node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2",
  "jetbrains-mono-500.woff2": "node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2",
};

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>vizier · ${esc(song0.title)}</title>
<link rel="icon" href="data:,">
<style>
@font-face { font-family: 'Special Elite'; src: url(/fonts/special-elite.ttf) format('truetype'); }
@font-face { font-family: 'Space Grotesk'; src: url(/fonts/space-grotesk-400.woff2) format('woff2'); font-weight: 400; }
@font-face { font-family: 'Space Grotesk'; src: url(/fonts/space-grotesk-500.woff2) format('woff2'); font-weight: 500 600; }
@font-face { font-family: 'JetBrains Mono'; src: url(/fonts/jetbrains-mono-400.woff2) format('woff2'); font-weight: 400; }
@font-face { font-family: 'JetBrains Mono'; src: url(/fonts/jetbrains-mono-500.woff2) format('woff2'); font-weight: 500; }
</style></head><body><div id="app"></div><script type="module" src="/app.js"></script></body></html>`;

// ---- caches ----
const waveCache = new Map<string, unknown>();
/** Min/max peaks at 100 per second, as signed bytes, base64: small enough to send every track. */
function waveform(file: string) {
  const path = trackPath(file);
  const key = `${path}|${statSync(path).mtimeMs}`;
  if (waveCache.has(key)) return waveCache.get(key);
  const x = decodeMono(path);
  const per = SAMPLE_RATE / 100, n = Math.ceil(x.length / per);
  const peaks = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    let lo = 0, hi = 0;
    for (let j = Math.floor(i * per); j < Math.min(x.length, Math.floor((i + 1) * per)); j++) { const v = x[j]!; if (v < lo) lo = v; if (v > hi) hi = v; }
    peaks.writeInt8(Math.round(Math.max(-1, lo) * 127), i * 2);
    peaks.writeInt8(Math.round(Math.min(1, hi) * 127), i * 2 + 1);
  }
  const out = { rate: 100, duration: x.length / SAMPLE_RATE, peaks: peaks.toString("base64") };
  waveCache.set(key, out);
  return out;
}

// ---- API ----
const json = (res: ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};
const readBody = (req: IncomingMessage) => new Promise<string>((ok, fail) => {
  let s = ""; req.setEncoding("utf8"); req.on("data", (c) => (s += c)); req.on("end", () => ok(s)); req.on("error", fail);
});
/** Pretty JSON with a trailing newline, as the files were written by hand: small, readable git diffs. */
const writeJson = (path: string, data: unknown) => writeFileSync(path, JSON.stringify(data, null, 2) + "\n");

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const p = url.pathname;
    if (p === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return void res.end(html); }
    if (p === "/app.js") { res.writeHead(200, { "content-type": "text/javascript" }); return void res.end(appJs); }
    if (p.startsWith("/fonts/") && fonts[p.slice(7)]) {
      const f = fonts[p.slice(7)]!;
      res.writeHead(200, { "content-type": f.endsWith(".ttf") ? "font/ttf" : "font/woff2", "cache-control": "max-age=86400" });
      return void createReadStream(join(root, f)).pipe(res);
    }
    if (p === "/api/session") {
      const song = loadSong(dir);
      const videos: Record<string, VideoFile> = Object.fromEntries(listVideos(dir).map((v) => [v, loadVideoFile(dir, v)]));
      return json(res, { id: dir.split("/").pop(), song, videos, initialVideo: values.video ?? Object.keys(videos)[0] ?? null });
    }
    if (p === "/api/waveform") return json(res, waveform(url.searchParams.get("file")!));
    if (p === "/api/features") {
      // features of every track, at a frame rate (the open video's): doesn't depend on any video file, so it works
      // for videos that haven't been saved yet
      const song = loadSong(dir);
      const fps = Number(url.searchParams.get("fps") ?? 30);
      if (!(fps > 0 && fps <= 240)) return json(res, { error: `bad fps ${fps}` }, 400);
      const tracks = Object.fromEntries(song.tracks.map((t) => [t.id, trackPath(t.file)]));
      return json(res, await loadFeatures(tracks, fps, join(dir, ".cache", "features")));
    }
    if (p === "/api/audio") {
      const path = trackPath(url.searchParams.get("file")!);
      if (!path.startsWith(dir) || !existsSync(path)) return json(res, { error: "not found" }, 404);
      res.writeHead(200, { "content-type": "audio/wav", "content-length": statSync(path).size });
      return void createReadStream(path).pipe(res);
    }
    if (p === "/api/heartbeat" && req.method === "POST") {
      const b = JSON.parse((await readBody(req)) || "{}") as { dirty?: boolean };
      browser = { lastSeen: Date.now(), dirty: !!b.dirty };
      return json(res, { ok: true });
    }
    if (p === "/api/save" && req.method === "POST") {
      const body = JSON.parse(await readBody(req)) as { song?: SongFile; videos?: Record<string, VideoFile> };
      const written: string[] = [];
      if (body.song) { writeJson(join(dir, "song.json"), body.song); written.push("song.json"); }
      for (const [name, v] of Object.entries(body.videos ?? {})) {
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) return json(res, { error: `bad video name ${name}` }, 400);
        writeJson(join(dir, "videos", `${name}.json`), v);
        written.push(`videos/${name}.json`);
      }
      log(`saved ${written.join(", ")}`);
      return json(res, { written });
    }
    res.writeHead(404).end("not found");
  } catch (e) {
    log(`error: ${(e as Error).message}`);
    json(res, { error: (e as Error).message }, 500);
  }
});
// The page reports every few seconds whether it has unsaved changes, so quitting can warn about them.
let browser = { lastSeen: 0, dirty: false };
process.on("SIGINT", () => {
  if (Date.now() - browser.lastSeen < 10_000 && browser.dirty) {
    log("You've quit with unsaved changes. They're still in the open editor window:");
    log(`restart the editor with   vizier editor ${relative(process.cwd(), dir) || "."} --no-open   and save (⌘S) in that window.`);
  }
  process.exit(0);
});

server.listen(Number(values.port), values.host, () => {
  const url = `http://localhost:${values.port}`;
  log(`ready: ${url} · ${dir}`);
  if (!values["no-open"] && !process.env.CI) openBrowser(url);
});

/** Open the editor in Chrome (falls back to the default browser). macOS and Linux desktops. */
function openBrowser(url: string) {
  const tryRun = (cmd: string, args: string[], fallback?: () => void) => {
    const p = spawn(cmd, args, { stdio: "ignore", detached: true });
    p.on("error", () => fallback?.());
    p.on("exit", (code) => { if (code !== 0) fallback?.(); });
    p.unref();
  };
  // A window of its own (Chrome's app mode: no tabs or address bar) rather than a tab in whichever window was last used.
  // -n starts a second copy of Chrome, which passes the request to the one already running.
  if (process.platform === "darwin") tryRun("open", ["-na", "Google Chrome", "--args", `--app=${url}`], () => tryRun("open", [url]));
  else if (process.platform === "linux" && process.env.DISPLAY) tryRun("xdg-open", [url]);
}

function esc(s: string) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!); }
function log(s: string) { process.stderr.write(`[vizier edit] ${s}\n`); }
function die(s: string): never { process.stderr.write(s + "\n"); process.exit(1); }
void readFileSync;
