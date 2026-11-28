#!/usr/bin/env node
/**
 * The editor: a local web app for a project folder.
 *   vizier editor projects/demo [--video full] [--port 5174] [--no-open]   opens http://localhost:5174 in a Chrome window of its own.
 *   vizier editor                                                          opens on a start page: a project in projects/, or a new one.
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
import { storeUpload, listMedia, settleMedia, clearIncoming, stemOffset } from "./media.ts";
import { listProjects, beginProject, addProjectMedia, finishProject, discardProject } from "./projects.ts";
import { analyze } from "../../offline/src/analyze.ts";
import { RenderQueue, listRenders, againOptions } from "./renders.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    video: { type: "string" }, port: { type: "string", default: "5174" }, host: { type: "string", default: "127.0.0.1" },
    "no-open": { type: "boolean", default: false },
    projects: { type: "string" },   // where projects are listed and made (default: projects/ in the repo; tests use their own)
  },
});
// Without a project folder, the editor opens on a start page (open a project in projects/, or make a new one).
// It can also switch project while running.
const projectsRoot = resolve(values.projects ?? join(root, "projects"));
let current: string | null = null;
let initialVideo = values.video;
/** The open project's folder. */
const need = (): string => { if (!current) throw new Error("no project is open"); return current; };
function openProject(d: string) {
  loadSong(d);                               // (a project: says so if there's no song.json)
  current = d;
  clearIncoming(d);                          // files dropped in an earlier session but never saved
  waveCache.clear(); checkCache.clear();
  log(`project: ${d}`);
}
const trackPath = (file: string) => resolve(need(), file);
/** A project file the page names, refused if it's outside the project folder. */
const projectFile = (file: string) => { const p = trackPath(file); if (!p.startsWith(need() + "/")) throw new Error(`not in the project: ${file}`); return p; };

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

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>vizier</title>
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
const checkCache = new Map<string, unknown>();
// renders run the same command as the terminal (on the GPU, unless VIZIER_RENDER_GPU=0: tests on machines without one)
const renders = new RenderQueue(join(root, "apps/offline/src/cli.ts"), process.env.VIZIER_RENDER_GPU !== "0", (s) => log(s));
if (positionals[0]) { try { openProject(projectDir(positionals[0])); } catch (e) { die((e as Error).message); } }
/** Min/max peaks at 100 per second, as signed bytes, base64: small enough to send every track. */
function waveform(file: string) {
  const path = projectFile(file);
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
const readBytes = (req: IncomingMessage) => new Promise<Buffer>((ok, fail) => {
  const parts: Buffer[] = [];
  req.on("data", (c: Buffer) => parts.push(c)); req.on("end", () => ok(Buffer.concat(parts))); req.on("error", fail);
});
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
      if (!current) return json(res, { noProject: true });
      const dir = current;
      const song = loadSong(dir);
      const videos: Record<string, VideoFile> = Object.fromEntries(listVideos(dir).map((v) => [v, loadVideoFile(dir, v)]));
      const first = initialVideo && videos[initialVideo] ? initialVideo : Object.keys(videos)[0] ?? null;
      return json(res, { id: dir.split("/").pop(), song, videos, initialVideo: first });
    }
    // ---- projects: list, open, make a new one (title, then its audio one file at a time, then finish) ----
    if (p === "/api/projects") return json(res, { projects: listProjects(projectsRoot), open: current && resolve(current, "..") === projectsRoot ? current.split("/").pop() : null });
    if (p === "/api/projects/open" && req.method === "POST") {
      const { id } = JSON.parse(await readBody(req)) as { id: string };
      if (!listProjects(projectsRoot).some((x) => x.id === id)) return json(res, { error: `no project ${id}` }, 404);
      openProject(join(projectsRoot, id)); initialVideo = undefined;
      return json(res, { ok: true });
    }
    if (p === "/api/projects/new" && req.method === "POST") {
      const { title } = JSON.parse(await readBody(req)) as { title: string };
      return json(res, { id: beginProject(projectsRoot, title) });
    }
    if (p === "/api/projects/media" && req.method === "POST") {
      return json(res, { file: addProjectMedia(projectsRoot, url.searchParams.get("id")!, url.searchParams.get("name") ?? "audio.wav", await readBytes(req)) });
    }
    if (p === "/api/projects/finish" && req.method === "POST") {
      const b = JSON.parse(await readBody(req)) as { id: string; mix: string; stems: string[] };
      const { dir: d, song } = finishProject(projectsRoot, b.id, b.mix, b.stems ?? []);
      log(`made ${relative(process.cwd(), d)} (${song.grid?.tempo[0]?.bpm} BPM, bar 1 at ${song.grid?.downbeat} s)`);
      openProject(d); initialVideo = undefined;
      return json(res, { ok: true });
    }
    if (p === "/api/projects/discard" && req.method === "POST") {
      discardProject(projectsRoot, (JSON.parse(await readBody(req)) as { id: string }).id);
      return json(res, { ok: true });
    }
    // lets a second `vizier editor` tell whether the port it wants is taken by a vizier editor, and on which project
    if (p === "/api/whoami") return json(res, { app: "vizier-editor", dir: current, pid: process.pid });
    if (p === "/api/waveform") return json(res, waveform(url.searchParams.get("file")!));
    if (p === "/api/features") {
      // features of every track, at a frame rate (the open video's). The page sends its tracks (id → file), so
      // tracks added since the last save are included; without them, the saved song's
      const fps = Number(url.searchParams.get("fps") ?? 30);
      if (!(fps > 0 && fps <= 240)) return json(res, { error: `bad fps ${fps}` }, 400);
      const given = url.searchParams.get("tracks");
      const files: Record<string, string> = given ? JSON.parse(given) : Object.fromEntries(loadSong(need()).tracks.map((t) => [t.id, t.file]));
      const tracks = Object.fromEntries(Object.entries(files).map(([id, f]) => [id, projectFile(f)]));
      return json(res, await loadFeatures(tracks, fps, join(need(), ".cache", "features")));
    }
    // a file dropped on the editor: kept in media/.incoming until the project is saved
    if (p === "/api/upload" && req.method === "POST") {
      const name = url.searchParams.get("name") ?? "audio.wav";
      const file = storeUpload(need(), name, await readBytes(req));
      log(`received ${name}`);
      return json(res, { file });
    }
    if (p === "/api/media") return json(res, listMedia(need()));
    // ---- renders: start (one or more videos), progress, cancel; the files in output/; play one; show it in Finder ----
    if (p === "/api/render" && req.method === "POST") {
      const b = JSON.parse(await readBody(req)) as { videos: string[]; whole?: boolean; options?: string[] };
      const dir = need();
      for (const v of b.videos) if (!listVideos(dir).includes(v)) return json(res, { error: `no saved video ${v} (save first)` }, 400);
      // (options only as the list of a past render gives them: againOptions keeps to the command's own)
      return json(res, { jobs: renders.add(dir, b.videos, !!b.whole, againOptions(["x", ...(b.options ?? [])])) });
    }
    if (p === "/api/render") {
      const dir = need();
      return json(res, { jobs: renders.jobs.filter((j) => j.dir === dir), files: listRenders(dir) });
    }
    if (p === "/api/render/cancel" && req.method === "POST") {
      renders.cancel((JSON.parse(await readBody(req)) as { id: number }).id);
      return json(res, { ok: true });
    }
    if (p === "/api/output") {
      const path = projectFile(url.searchParams.get("file")!);
      if (!path.startsWith(join(need(), "output") + "/") || !existsSync(path)) return json(res, { error: "not found" }, 404);
      if (path.endsWith(".jpg")) { res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" }); return void createReadStream(path).pipe(res); }
      // ranges, so the player can seek
      const size = statSync(path).size, range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
      if (range) {
        const from = range[1] ? Number(range[1]) : size - Number(range[2]), to = range[1] && range[2] ? Number(range[2]) : size - 1;
        res.writeHead(206, { "content-type": "video/mp4", "content-range": `bytes ${from}-${to}/${size}`, "accept-ranges": "bytes", "content-length": to - from + 1 });
        return void createReadStream(path, { start: from, end: to }).pipe(res);
      }
      res.writeHead(200, { "content-type": "video/mp4", "content-length": size, "accept-ranges": "bytes" });
      return void createReadStream(path).pipe(res);
    }
    if (p === "/api/reveal" && req.method === "POST") {
      const path = projectFile((JSON.parse(await readBody(req)) as { file: string }).file);
      if (!existsSync(path)) return json(res, { error: "not found" }, 404);
      if (process.env.VIZIER_NO_REVEAL !== "1") {
        if (process.platform === "darwin") spawn("open", ["-R", path], { stdio: "ignore", detached: true }).unref();
        else spawn("xdg-open", [resolve(path, "..")], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
      }
      return json(res, { ok: true });
    }
    // the tempo and where bar 1 starts, worked out from a file (the mix): suggestions for the tempo panel
    if (p === "/api/tempo") {
      const f = projectFile(url.searchParams.get("file")!);
      const key = `tempo|${f}|${statSync(f).mtimeMs}`;
      if (!checkCache.has(key)) {
        const a = analyze([{ id: "mix", samples: decodeMono(f) }], "mix", SAMPLE_RATE);
        checkCache.set(key, { bpm: a.bpm, downbeat: Math.round(a.downbeat * 1000) / 1000, beatsPerBar: a.beatsPerBar, candidates: a.tempo.slice(0, 5) });
      }
      return json(res, checkCache.get(key));
    }
    // a track's length, and how far it's shifted against the mix
    if (p === "/api/trackcheck") {
      const file = url.searchParams.get("file")!, mix = url.searchParams.get("mix")!;
      const fa = projectFile(mix), fb = projectFile(file);
      const key = `${fa}|${statSync(fa).mtimeMs}|${fb}|${statSync(fb).mtimeMs}`;
      if (!checkCache.has(key)) {
        const a = decodeMono(fa), b = file === mix ? a : decodeMono(fb);
        checkCache.set(key, { seconds: b.length / SAMPLE_RATE, mixSeconds: a.length / SAMPLE_RATE, offset: file === mix ? 0 : stemOffset(a, b, SAMPLE_RATE) ?? null });
      }
      return json(res, checkCache.get(key));
    }
    if (p === "/api/audio") {
      const path = trackPath(url.searchParams.get("file")!);
      if (!path.startsWith(need() + "/") || !existsSync(path)) return json(res, { error: "not found" }, 404);
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
      let media: ReturnType<typeof settleMedia> | undefined;
      if (body.song) {
        // dropped files move into media/ now; the song is written with their final names
        media = settleMedia(need(), loadSong(need()), body.song);
        writeJson(join(need(), "song.json"), media.song); written.push("song.json");
        for (const to of Object.values(media.moved)) log(`added ${to}`);
        for (const f of media.deleted) log(`deleted ${f} (replaced)`);
      }
      for (const [name, v] of Object.entries(body.videos ?? {})) {
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) return json(res, { error: `bad video name ${name}` }, 400);
        writeJson(join(need(), "videos", `${name}.json`), v);
        written.push(`videos/${name}.json`);
      }
      log(`saved ${written.join(", ")}`);
      return json(res, { written, moved: media?.moved ?? {} });
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
    log(`restart the editor with   vizier editor ${relative(process.cwd(), current ?? ".") || "."} --no-open   and save (⌘S) in that window.`);
  }
  process.exit(0);
});

// Listen on the port asked for. If it's taken: by an editor on this project, open that one and stop; otherwise
// (another project's editor, or some other program) try the next few ports.
const firstPort = Number(values.port);
function listen(port: number) {
  server.once("error", async (e: NodeJS.ErrnoException) => {
    if (e.code !== "EADDRINUSE") throw e;
    const other = await fetch(`http://${values.host}:${port}/api/whoami`, { signal: AbortSignal.timeout(1500) })
      .then((r) => r.json() as Promise<{ app?: string; dir?: string; pid?: number }>).catch(() => null);
    const url = `http://localhost:${port}`;
    if (other?.app === "vizier-editor" && other.dir === current) {
      log(`already running for this project at ${url} (process ${other.pid}); opening that one`);
      log(`(to stop it: Ctrl-C in its Terminal, or   kill ${other.pid})`);
      if (!values["no-open"] && !process.env.CI) openBrowser(url);
      process.exit(0);
    }
    log(other?.app === "vizier-editor"
      ? `port ${port} is in use by the editor for ${other.dir} (process ${other.pid}); trying ${port + 1}`
      : `port ${port} is in use by another program; trying ${port + 1}`);
    if (port + 1 > firstPort + 10) die(`No free port between ${firstPort} and ${port}. Choose one with --port.`);
    listen(port + 1);
  });
  server.listen(port, values.host, () => {
    const url = `http://localhost:${port}`;
    log(`ready: ${url} · ${current ?? "no project open: pick one, or make a new one"}`);
    if (!values["no-open"] && !process.env.CI) openBrowser(url);
  });
}
listen(firstPort);

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
