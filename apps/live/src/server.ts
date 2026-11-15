#!/usr/bin/env node
/**
 * Live window (first version): plays a project's main mix and renders the visuals in time with it,
 * fullscreen in Chrome, with a dropped-frame HUD. Features are precomputed from the stems for now;
 * live audio input replaces them later (docs/roadmap.md).
 *
 *   pnpm live examples/ozgun-acid/project.json [--profile live|live720] [--port 5173]
 *   then open http://localhost:5173 in Chrome.
 */
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { readFileSync, statSync, createReadStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { getProfile, validateProject, type Project } from "../../../packages/core/src/index.ts";
import { loadFeatures } from "../../offline/src/audio.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { profile: { type: "string", default: "live" }, port: { type: "string", default: "5173" } },
});
const projectPath = resolve(positionals[0] ?? die("usage: pnpm live <project.json> [--profile live] [--port 5173]"));
const project: Project = JSON.parse(readFileSync(projectPath, "utf8"));
const errs = validateProject(project);
if (errs.length) die("Invalid project:\n  " + errs.join("\n  "));
const profile = getProfile(values.profile!);
const projectDir = dirname(projectPath);
const stemPaths = Object.fromEntries(Object.entries(project.stems).map(([k, v]) => [k, resolve(projectDir, v)]));
if (!stemPaths.main) die("The project needs a `main` stem to play.");

log(`analysing stems at ${profile.fps} fps…`);
const features = JSON.stringify(await loadFeatures(stemPaths, profile.fps));
const bundle = (await build({
  entryPoints: [root + "apps/live/src/page.ts"], bundle: true, write: false, format: "iife", target: "es2022",
  tsconfig: root + "tsconfig.json", logLevel: "error",
})).outputFiles[0]!.text;
const font = readFileSync(root + "assets/fonts/SpecialElite-Regular.ttf");
const config = JSON.stringify({ profileId: profile.id, project });

const html = `<!doctype html><html><head><meta charset="utf-8"><title>vizier live · ${escapeHtml(project.title)}</title><style>
@font-face { font-family: 'Special Elite'; src: url(/font.ttf) format('truetype'); }
html, body { margin: 0; height: 100%; background: #000; overflow: hidden; cursor: none; }
canvas { width: 100vw; height: 100vh; object-fit: contain; display: block; }
#hud { position: fixed; top: 8px; left: 8px; font: 12px/1.35 ui-monospace, Menlo, monospace; color: #cfc;
  background: rgba(0,0,0,.65); padding: 8px 10px; border-radius: 4px; white-space: pre; pointer-events: none; }
#start { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; cursor: pointer;
  font: 28px 'Special Elite', monospace; color: #FCFCFB; background: #2B2420; }
</style></head><body><div id="start">loading…</div><pre id="hud"></pre><script src="/app.js"></script></body></html>`;

const server = createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  const send = (type: string, body: string | Buffer) => { res.writeHead(200, { "content-type": type, "cache-control": "no-store" }); res.end(body); };
  if (url === "/") return send("text/html; charset=utf-8", html);
  if (url === "/app.js") return send("text/javascript", bundle);
  if (url === "/config.json") return send("application/json", config);
  if (url === "/features.json") return send("application/json", features);
  if (url === "/font.ttf") return send("font/ttf", font);
  if (url === "/audio/main") {
    const p = stemPaths.main!;
    res.writeHead(200, { "content-type": "audio/wav", "content-length": statSync(p).size, "cache-control": "no-store" });
    return void createReadStream(p).pipe(res);
  }
  if (url === "/favicon.ico") return void res.writeHead(204).end();
  res.writeHead(404).end("not found");
});
server.listen(Number(values.port), "127.0.0.1", () => {
  log(`ready: open http://localhost:${values.port} in Chrome (${profile.label}). Ctrl+C to stop.`);
});

function escapeHtml(s: string) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!); }
function log(s: string) { process.stderr.write(`[vizier live] ${s}\n`); }
function die(s: string): never { process.stderr.write(s + "\n"); process.exit(1); }
