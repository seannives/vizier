// Bug sweep: the editor's smaller preview must look like the export. Every generator and effect, with default
// and with maximum parameters, is rendered at two sizes; the larger frame is shrunk to the smaller one's size and
// compared. Anything sized in fixed pixels (instead of fractions of the frame, or `pixels: true` parameters, which
// the preview scales) shows up as a large difference. Renders at half and quarter size (cheaper than full and
// half, and it's the ratio between the sizes that matters). Film grain is off: it's random per pixel.
import { describe, it, expect, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { makeDemoTracks, DEMO } from "../../../scripts/demo-audio.ts";
import { analyzeSignal } from "../../../packages/features/src/index.ts";
import { GENERATORS, EFFECTS, type LayerDef, type Project } from "../../../packages/core/src/index.ts";
import { openRenderer, closeSharedBrowsers } from "../src/browser.ts";

const chrome = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find((p) => p && existsSync(p));
if (chrome) process.env.CHROME_PATH = chrome;
const run = chrome && !process.env.VIZIER_QUICK ? describe : describe.skip;

const fps = 30;
const signals = makeDemoTracks();
const tracks = Object.fromEntries(Object.entries(signals).map(([k, s]) => [k, analyzeSignal(s, { sampleRate: DEMO.sampleRate, fps })]));
const grid = { tempo: [{ bar: 1, bpm: DEMO.bpm, beatsPerBar: 4 }], downbeat: DEMO.leadIn };
const frameAt = (bar: number) => Math.round((DEMO.leadIn + ((bar - 1) * 4 * 60) / DEMO.bpm) * fps);
const FULL = { landscape: { x: 0.5, y: 0.5, w: 1, h: 1 } };
const W = 480, H = 270; // the draft profile at half size; compared against a quarter-size render

/** Mean difference per pixel and channel, as a share of the picture's mean brightness. */
function mismatch(big: Buffer, small: Buffer): number {
  let d = 0, m = 0;
  for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) for (let c = 0; c < 3; c++) {
    const at = (xx: number, yy: number) => big[(yy * W + xx) * 4 + c]!;
    const avg = (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) / 4;
    d += Math.abs(avg - small[(y * (W / 2) + x) * 4 + c]!); m += avg;
  }
  return d / Math.max(1, m);
}
/** Render each variant of the layers at both sizes (one pair of renderers, each variant applied as an edit, so
 *  the shaders compile once) and measure how far apart they are. `history`: frames rendered first (trails need
 *  some). */
async function compare(variants: LayerDef[][], bar: number, history = 3): Promise<number[]> {
  const proj = (layers: LayerDef[]): Project => ({ version: 2, title: "t", seed: 1, tracks: Object.fromEntries(Object.keys(tracks).map((k) => [k, k])), mix: "mix", grid,
    palette: {}, automation: [{ target: "post.grain", points: [{ t: 0, v: 0 }] }], layers });
  const big = await openRenderer(proj(variants[0]!), "draft", tracks, { gpu: false, scale: 0.5, shared: true });
  const small = await openRenderer(proj(variants[0]!), "draft", tracks, { gpu: false, scale: 0.25, shared: true });
  try {
    const out: number[] = [];
    const f = frameAt(bar);
    for (const v of variants) {
      await big.update(proj(v)); await small.update(proj(v));
      for (let k = f - history; k < f; k++) { await big.render(k); await small.render(k); }
      out.push(mismatch(await big.frame(f), await small.frame(f)));
    }
    return out;
  } finally { await big.close(); await small.close(); }
}
const maxed = (specs: { name: string; max: number }[]) => Object.fromEntries(specs.map((s) => [s.name, s.max]));

// where each generator is busy in the demo, and the track it listens to
const SETUP: Record<string, { track: string; bar: number; params?: Record<string, number> }> = {
  acidRing: { track: "bass", bar: 20 }, pulseGrid: { track: "mix", bar: 12.5 }, flowField: { track: "drums", bar: 12.5 },
  ridgeline: { track: "pad", bar: 27.5 }, typeText: { track: "mix", bar: 12.5, params: { size: 0.5, stutter: 0.6, shake: 1, blur: 4 } },
  lasers: { track: "drums", bar: 12.5 }, tunnel: { track: "drums", bar: 12.5 }, truchet: { track: "drums", bar: 12.5 },
};
// Fine detail drawn in the generator's own units (not pixels) aliases more at a smaller size. That's sampling, not
// a units mismatch, and Full preview quality shows the real thing; these limits are looser accordingly.
// The pulse grid at its maximum density draws dots under a pixel across at these test sizes, which browsers
// antialias a little differently (0.02 here, 0.09 on GitHub's machines); its units bug showed even at the
// default density (0.13), which keeps the default limit.
// The tunnel's and the Truchet maze's lines are a share of a ring or tile, a pixel or so wide at the quarter size
// tested here (a maze tile is 11 px; in the editor's preview, 45): the same pattern at the same size, just
// pixelated (measured 0.084 and 0.19; at their maximum settings, 0.005 and 0.04).
const LIMIT: Record<string, number> = { default: 0.08, flowField: 0.2, "flowField max": 0.6, "pulseGrid max": 0.15, tunnel: 0.12, truchet: 0.25 };

run("bug sweep: the smaller preview looks like the export", () => {
  afterAll(closeSharedBrowsers);
  it("covers every generator and effect", () => {
    expect(Object.keys(SETUP).sort()).toEqual(Object.keys(GENERATORS).sort());
  });
  for (const g of Object.values(GENERATORS)) {
    const s = SETUP[g.id]!;
    const layer = (params?: Record<string, number>): LayerDef => ({ id: "l", track: s.track, generator: g.id, z: 0, layout: FULL, text: "the maleficus", params: params ?? s.params ?? {} });
    it(`${g.id}: default parameters, and every parameter at its maximum`, async () => {
      const [def, max] = await compare([[layer()], [layer({ ...maxed(g.params), ...(g.id === "typeText" ? { size: 0.5 } : {}) })]], s.bar);
      expect(def, "default parameters").toBeLessThan(LIMIT[g.id] ?? LIMIT.default!);
      expect(max, "maximum parameters").toBeLessThan(LIMIT[`${g.id} max`] ?? LIMIT.default!);
    }, 180_000);
  }
  for (const e of Object.values(EFFECTS)) {
    const ring = (params?: Record<string, number>): LayerDef[] => [{ id: "l", track: "bass", generator: "acidRing", z: 0, layout: FULL, effects: [{ type: e.id, ...(params ? { params } : {}) }] }];
    it(`effect ${e.id}: default and maximum parameters`, async () => {
      const [def, max] = await compare([ring(), ring(maxed(e.params))], 20, 12);
      expect(def, "default parameters").toBeLessThan(LIMIT.default!);
      expect(max, "maximum parameters").toBeLessThan(LIMIT.default!);
    }, 180_000);
  }
  it("a layer drawn at reduced resolution (resolutionScale), with glow", async () => {
    const [d] = await compare([[{ id: "l", track: "bass", generator: "acidRing", z: 0, layout: FULL, resolutionScale: 0.5, effects: [{ type: "glow" }] }]], 20);
    expect(d).toBeLessThan(LIMIT.default!);
  }, 180_000);
});
