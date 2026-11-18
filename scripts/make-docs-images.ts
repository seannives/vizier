/**
 * Renders the pictures in docs/visuals.md from the demo song's generated audio: each generator on its own, each
 * effect on the acid ring, and the whole demo video. Deterministic, so the pictures only change when the visuals do.
 *
 *   vizier docs-images            (or: node --experimental-strip-types scripts/make-docs-images.ts)
 *
 * Needs Chrome and ffmpeg, like rendering. Writes docs/images/visuals/*.jpg.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeDemoTracks, DEMO } from "./demo-audio.ts";
import { analyzeSignal } from "../packages/features/src/index.ts";
import type { LayerDef, Project } from "../packages/core/src/index.ts";
import { openRenderer } from "../apps/offline/src/browser.ts";
import { startEncoder } from "../apps/offline/src/encode.ts";
import { loadProject } from "../apps/offline/src/project-io.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const outDir = join(root, "docs/images/visuals");
mkdirSync(outDir, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "vizier-docs-"));

const fps = 30;
const signals = makeDemoTracks();
const tracks = Object.fromEntries(Object.entries(signals).map(([k, s]) => [k, analyzeSignal(s, { sampleRate: DEMO.sampleRate, fps })]));
const grid = { tempo: [{ bar: 1, bpm: DEMO.bpm, beatsPerBar: 4 }], downbeat: DEMO.leadIn };
const frameAt = (bar: number) => Math.round((DEMO.leadIn + ((bar - 1) * 4 * 60) / DEMO.bpm) * fps);
const palette = { bg: "#2B2420", ink: "#FCFCFB", accent: "#B6FF3B", extra1: "#E0533A", extra2: "#5B8CFF" };
const FULL = { landscape: { x: 0.5, y: 0.5, w: 1, h: 1 } };

/** One picture: the layers on their own, at a bar of the demo. */
async function shot(name: string, layers: LayerDef[], bar: number, project?: Project) {
  const p: Project = project ?? { version: 2, title: "docs", seed: 1, tracks: Object.fromEntries(Object.keys(tracks).map((k) => [k, k])), mix: "mix", grid, palette, layers };
  const r = await openRenderer(p, "draft", tracks, { gpu: false });
  const png = join(tmp, `${name}.png`), jpg = join(outDir, `${name}.jpg`);
  try {
    const enc = startEncoder({ out: png, width: 960, height: 540, fps, still: true });
    await enc.write(await r.frame(frameAt(bar)));
    await enc.finish();
  } finally { await r.close(); }
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", png, "-q:v", "3", jpg]);
  process.stderr.write(`wrote docs/images/visuals/${name}.jpg\n`);
}

const ring = (extra: Partial<LayerDef> = {}): LayerDef => ({ id: "ring", track: "bass", generator: "acidRing", z: 0, blend: "add", layout: FULL, ...extra });
await shot("acidRing", [ring()], 20);
await shot("pulseGrid", [{ id: "grid", track: "mix", generator: "pulseGrid", z: 0, layout: FULL }], 12.5);
await shot("flowField", [{ id: "flow", track: "drums", generator: "flowField", z: 0, layout: FULL }], 12.5);
await shot("ridgeline", [{ id: "ridge", track: "pad", generator: "ridgeline", z: 0, params: { acid: 1 }, layout: FULL }], 27.5);
await shot("typeText", [{ id: "title", track: "mix", generator: "typeText", z: 0, text: "the maleficus", params: { size: 0.5, stutter: 0.6 },
  layout: { landscape: { x: 0.5, y: 0.5, w: 0.9, h: 0.3 } } }], 12.5);
await shot("glow", [ring({ effects: [{ type: "glow", params: { amount: 3, radius: 30 } }] })], 20);
await shot("trails", [ring({ effects: [{ type: "trails", params: { persistence: 1, zoom: 1.3, rotate: 20 } }] })], 20);
await shot("hueShift", [ring({ params: { hueShift: 120 }, effects: [{ type: "glow" }] })], 20);
const demo = loadProject(join(root, "projects/demo"), "full");
await shot("demo-full", [], 20, demo.project);
rmSync(tmp, { recursive: true, force: true });
