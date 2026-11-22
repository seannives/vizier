// Renders real frames in headless Chrome (software GL). Skipped when no Chrome is available.
import { describe, it, expect, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { analyzeSignal } from "../../../packages/features/src/index.ts";
import type { Project } from "../../../packages/core/src/index.ts";
import { openRenderer, closeSharedBrowsers } from "../src/browser.ts";

// Find Chrome: $CHROME_PATH, else the standard install location on macOS or Linux.
const candidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter((p): p is string => !!p);
const chrome = candidates.find((p) => existsSync(p));
// VIZIER_QUICK=1 (pnpm test:quick) skips the tests that drive Chrome
const run = chrome && !process.env.VIZIER_QUICK ? describe : describe.skip;
if (chrome) process.env.CHROME_PATH = chrome;

const SR = 48000;
const signal = Float32Array.from({ length: SR * 2 }, (_, i) => (i % 12000 < 2000 ? 0.6 : 0.1) * Math.sin((2 * Math.PI * 55 * i) / SR));
const project: Project = {
  version: 2, title: "test", seed: 7, tracks: { mix: "x", bass: "x" }, mix: "mix",
  palette: { bg: "#2B2420", ink: "#FCFCFB", acid: "#B6FF3B" },
  layers: [
    { id: "grid", track: "mix", generator: "pulseGrid", z: 0, layout: { landscape: { x: 0.5, y: 0.5, w: 1, h: 1 } } },
    { id: "bass", track: "bass", generator: "acidRing", z: 1, blend: "add", layout: { landscape: { x: 0.5, y: 0.5, w: 0.56, h: 1 } } },
    { id: "title", generator: "typeText", z: 2, text: "test", params: { shake: 1, stutter: 1 }, layout: { landscape: { x: 0.5, y: 0.85, w: 0.6, h: 0.15 } } },
  ],
};

const fxProject: Project = {
  ...project,
  layers: [
    { id: "flow", track: "mix", generator: "flowField", z: 0, blend: "add", effects: [{ type: "glow" }], layout: { landscape: { x: 0.5, y: 0.5, w: 1, h: 1 } } },
    { id: "ring", track: "bass", generator: "acidRing", z: 1, blend: "add", effects: [{ type: "trails", params: { persistence: 1, zoom: 1.3, rotate: 20 } }], layout: { landscape: { x: 0.5, y: 0.5, w: 0.56, h: 1 } } },
    { id: "chorus", track: "mix", generator: "ridgeline", z: 2, layout: { landscape: { x: 0.5, y: 0.75, w: 1, h: 0.5 } } },
  ],
};

// Software rendering is slow and these tests run alongside the editor's browser tests, so they draw at half size
// in each direction (a quarter of the pixels) unless the size is what's being tested, and allow plenty of time.
const SMALL = { gpu: false, scale: 0.5, shared: true }; // one Chrome for the file, a tab per renderer
const W = 480, H = 270; // the draft profile (960×540) at half size

run("renderer in headless Chrome", () => {
  afterAll(closeSharedBrowsers);
  it("draws non-blank frames, and the same frame twice is byte-identical", async () => {
    const track = analyzeSignal(signal, { sampleRate: SR, fps: 30 });
    const r = await openRenderer(project, "draft", { mix: track, bass: track }, SMALL);
    try {
      const a = await r.frame(20), b = await r.frame(45), a2 = await r.frame(20);
      expect(a.length).toBe(W * H * 4);
      const hash = (x: Buffer) => createHash("sha1").update(x).digest("hex");
      expect(hash(a2)).toBe(hash(a));      // determinism: rendering is a pure function of the frame number
      expect(hash(b)).not.toBe(hash(a));   // and frames do change over time
      let lit = 0;
      for (let i = 0; i < a.length; i += 4) if (a[i]! > 120) lit++;
      expect(lit).toBeGreaterThan(500);   // something brighter than the background was drawn
    } finally { await r.close(); }
  }, 180_000);

  it("renders shader generators and effect chains", async () => {
    const track = analyzeSignal(signal, { sampleRate: SR, fps: 30 });
    const r = await openRenderer(fxProject, "draft", { mix: track, bass: track }, SMALL);
    try {
      const px = await r.frame(40);
      let lit = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i + 1]! > 100) lit++;
      expect(lit).toBeGreaterThan(1000);
    } finally { await r.close(); }
  }, 180_000);

  it("a frame with trails looks the same whether rendered in sequence or jumped to (lead-in)", async () => {
    const track = analyzeSignal(signal, { sampleRate: SR, fps: 30 });
    const hash = (x: Buffer) => createHash("sha1").update(x).digest("hex");
    const a = await openRenderer(fxProject, "draft", { mix: track, bass: track }, SMALL);
    const b = await openRenderer(fxProject, "draft", { mix: track, bass: track }, SMALL);
    try {
      let seq: Buffer = Buffer.alloc(0);
      for (let f = 0; f < 45; f++) await a.render(f);        // sequential, as in a full render
      seq = await a.frame(45);
      const jumped = await b.frame(45);                       // straight to frame 45, as in an excerpt
      expect(hash(jumped)).toBe(hash(seq));
    } finally { await a.close(); await b.close(); }
  }, 180_000);

  it("palette lanes change the picture (background follows palette.bg)", async () => {
    const track = analyzeSignal(signal, { sampleRate: SR, fps: 30 });
    const p: Project = { ...project, layers: [], automation: [{ target: "palette.bg", points: [{ t: 0, c: "#ff0000", curve: "hold" }, { t: 1, c: "#0000ff" }] }] };
    const r = await openRenderer(p, "draft", { mix: track, bass: track }, SMALL);
    try {
      const centre = (px: Buffer) => { const i = ((H / 2) * W + W / 2) * 4; return [px[i]!, px[i + 1]!, px[i + 2]!]; };
      const [r0, , b0] = centre(await r.frame(10)); // 0.33 s: red
      const [r1, , b1] = centre(await r.frame(40)); // 1.33 s: blue
      expect(r0).toBeGreaterThan(200); expect(b0).toBeLessThan(60);
      expect(b1).toBeGreaterThan(200); expect(r1).toBeLessThan(60);
    } finally { await r.close(); }
  }, 180_000);

  it("encodes H.264 in the browser (WebCodecs) as an Annex B stream with SPS/PPS and a keyframe", async () => {
    const track = analyzeSignal(signal, { sampleRate: SR, fps: 30 });
    const r = await openRenderer(project, "draft", { mix: track, bass: track }, SMALL);
    try {
      const info = await r.encodeStart(4);
      expect(info.codec).toMatch(/^avc1\.6400/);
      const parts = [await r.encodeFrames(0, 20, 0), await r.encodeFinish()];
      const bytes = Buffer.concat(parts);
      expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0, 0, 0, 1]));
      const nalTypes = new Set<number>();
      for (let i = 0; i + 4 < bytes.length; i++) if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) nalTypes.add(bytes[i + 3]! & 0x1f);
      expect(nalTypes.has(7)).toBe(true); // SPS
      expect(nalTypes.has(8)).toBe(true); // PPS
      expect(nalTypes.has(5)).toBe(true); // IDR keyframe
    } finally { await r.close(); }
  }, 180_000);
  it("doesn't draw a layer outside its on-spans", async () => {
    const track = analyzeSignal(signal, { sampleRate: SR, fps: 30 });
    const grid = { tempo: [{ bar: 1, bpm: 120, beatsPerBar: 4 }], downbeat: 0 }; // a bar is 2 s
    const ring = { ...project.layers[1]!, spans: [{ from: 1.5 }] };              // on from 1 s
    const hash = (x: Buffer) => createHash("sha1").update(x).digest("hex");
    const withRing = await openRenderer({ ...project, grid, layers: [project.layers[0]!, ring] }, "draft", { mix: track, bass: track }, SMALL);
    const without = await openRenderer({ ...project, grid, layers: [project.layers[0]!] }, "draft", { mix: track, bass: track }, SMALL);
    try {
      expect(hash(await withRing.frame(15))).toBe(hash(await without.frame(15)));       // 0.5 s: off
      expect(hash(await withRing.frame(45))).not.toBe(hash(await without.frame(45)));   // 1.5 s: on
    } finally { await withRing.close(); await without.close(); }
  }, 180_000);
  it("an edit applied to a running renderer keeps its trails (and still takes effect)", async () => {
    const track = analyzeSignal(signal, { sampleRate: SR, fps: 30 });
    const hash = (x: Buffer) => createHash("sha1").update(x).digest("hex");
    const tracks = { mix: track, bass: track };
    // a: renders frames in order, gets the same project again as an edit at frame 20; b: never edited
    const a = await openRenderer(fxProject, "draft", tracks, SMALL);
    const b = await openRenderer(fxProject, "draft", tracks, SMALL);
    try {
      for (let f = 0; f <= 20; f++) { await a.render(f); await b.render(f); }
      await a.update(structuredClone(fxProject));
      expect(hash(await a.frame(21))).toBe(hash(await b.frame(21)));   // the trails carried on exactly
      // a real edit (the ring's radius) shows from the next frame
      const edited = structuredClone(fxProject);
      edited.layers[1]!.params = { radius: 0.4 };
      await a.update(edited);
      expect(hash(await a.frame(22))).not.toBe(hash(await b.frame(22)));
    } finally { await a.close(); await b.close(); }
  }, 180_000);
  it("a smaller preview matches the export: glow spreads over the same share of the picture", async () => {
    const track = analyzeSignal(signal, { sampleRate: SR, fps: 30 });
    const withGlow = (radius: number): Project => ({ ...project, automation: [{ target: "post.grain", points: [{ t: 0, v: 0 }] }], // no grain: it's random per pixel
      layers: [{ ...project.layers[1]!, effects: [{ type: "glow", params: { amount: 3, radius } }] }] });
    // the full-size frame shrunk to half (2×2 averages), against a half-size preview: mean difference per pixel
    const W = 960, H = 540;
    const diff = (fullPx: Buffer, halfPx: Buffer) => {
      let sum = 0;
      for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) for (let ch = 0; ch < 3; ch++) {
        const at = (xx: number, yy: number) => fullPx[(yy * W + xx) * 4 + ch]!;
        const avg = (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) / 4;
        sum += Math.abs(avg - halfPx[(y * (W / 2) + x) * 4 + ch]!);
      }
      return sum / ((W / 2) * (H / 2) * 3);
    };
    const tracks = { mix: track, bass: track };
    const full = await openRenderer(withGlow(20), "draft", tracks, { gpu: false, shared: true });
    const half = await openRenderer(withGlow(20), "draft", tracks, { gpu: false, scale: 0.5, shared: true });
    // what the half-size preview showed before glow sizes were scaled: twice the radius, relative to the picture
    const unscaled = await openRenderer(withGlow(40), "draft", tracks, { gpu: false, scale: 0.5, shared: true });
    try {
      const f = await full.frame(30);
      const scaled = diff(f, await half.frame(30)), before = diff(f, await unscaled.frame(30));
      // far closer to the export than before (not exact: smaller pictures antialias differently, and grain differs)
      expect(scaled, `scaled preview ${scaled}, unscaled ${before}`).toBeLessThan(before * 0.7);
    } finally { await full.close(); await half.close(); await unscaled.close(); }
  }, 180_000);
  it("glow sizes are in pixels of the video, also on a layer drawn at reduced resolution", async () => {
    const track = analyzeSignal(signal, { sampleRate: SR, fps: 30 });
    const ring = (radius: number, resolutionScale?: number): Project => ({ ...project, automation: [{ target: "post.grain", points: [{ t: 0, v: 0 }] }],
      layers: [{ ...project.layers[1]!, ...(resolutionScale ? { resolutionScale } : {}), effects: [{ type: "glow", params: { amount: 3, radius } }] }] });
    const shot = async (p: Project) => { const r = await openRenderer(p, "draft", { mix: track, bass: track }, SMALL); try { return await r.frame(30); } finally { await r.close(); } };
    const diff = (a: Buffer, b: Buffer) => { let d = 0; for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i]! - b[i]!); return d / (a.length / 4); };
    const full = await shot(ring(16)), half = await shot(ring(16, 0.5)), doubled = await shot(ring(32));
    // the half-resolution layer's glow matches the same radius at full resolution, not twice it
    expect(diff(half, full)).toBeLessThan(diff(half, doubled));
  }, 180_000);

  it("layers blend with the background colour (multiply darkens it)", async () => {
    const track = analyzeSignal(signal, { sampleRate: SR, fps: 30 });
    const grey: Project = { ...project, palette: { bg: "#C08040" }, automation: [{ target: "post.grain", points: [{ t: 0, v: 0 }] }, { target: "post.vignette", points: [{ t: 0, v: 0 }] }],
      layers: [{ id: "flow", track: "mix", generator: "flowField", z: 0, blend: "multiply", colors: { line: "#404040", highlight: "#404040" }, params: { thickness: 0.5, brightness: 3 }, layout: { landscape: { x: 0.5, y: 0.5, w: 1, h: 1 } } }] };
    const r = await openRenderer(grey, "draft", { mix: track, bass: track }, SMALL);
    try {
      const px = await r.frame(30);
      let darker = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i]! < 0xc0 - 30) darker++;
      expect(darker / (px.length / 4)).toBeGreaterThan(0.02); // multiply darkened the background where the lines are
    } finally { await r.close(); }
  }, 180_000);
  it("trails fade all the way out (an 8-bit feedback buffer would keep a faint haze for ever)", async () => {
    const track = analyzeSignal(signal, { sampleRate: SR, fps: 30 });
    const text = (reveal: { t: number; v: number; curve?: "hold" }[]): Project => ({ ...project,
      automation: [{ target: "post.grain", points: [{ t: 0, v: 0 }] }, { target: "post.vignette", points: [{ t: 0, v: 0 }] }, { target: "title.reveal", points: reveal }],
      layers: [{ id: "title", generator: "typeText", z: 0, blend: "add", text: "HAZE", params: { size: 0.9 },
        effects: [{ type: "trails", params: { persistence: 1, zoom: 1, rotate: 0 } }], layout: { landscape: { x: 0.5, y: 0.5, w: 0.8, h: 0.6 } } }] });
    const shot = async (p: Project) => { const r = await openRenderer(p, "draft", { mix: track, bass: track }, SMALL); try { await r.frame(0); return await r.frame(57); } finally { await r.close(); } };
    // the text shows until 0.3 s, then 1.6 s of fading: by 1.9 s nothing is left, so the frame is the background
    const faded = await shot(text([{ t: 0, v: 1 }, { t: 0.3, v: 1, curve: "hold" }, { t: 0.31, v: 0 }]));
    const never = await shot(text([{ t: 0, v: 0 }]));
    let left = 0;
    for (let i = 0; i < faded.length; i++) if (faded[i] !== never[i]) left++;
    expect(left).toBe(0);
  }, 180_000);
});
