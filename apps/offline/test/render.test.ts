// Renders real frames in headless Chrome (software GL). Skipped when no Chrome is available.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { analyzeSignal } from "../../../packages/features/src/index.ts";
import type { Project } from "../../../packages/core/src/index.ts";
import { openRenderer } from "../src/browser.ts";

// Find Chrome: $CHROME_PATH, else the standard install location on macOS or Linux.
const candidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter((p): p is string => !!p);
const chrome = candidates.find((p) => existsSync(p));
const run = chrome ? describe : describe.skip;
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

run("renderer in headless Chrome", () => {
  it("draws non-blank frames, and the same frame twice is byte-identical", async () => {
    const track = analyzeSignal(signal, { sampleRate: SR, fps: 30 });
    const r = await openRenderer(project, "draft", { mix: track, bass: track }, { gpu: false });
    try {
      const a = await r.frame(20), b = await r.frame(45), a2 = await r.frame(20);
      expect(a.length).toBe(960 * 540 * 4);
      const hash = (x: Buffer) => createHash("sha1").update(x).digest("hex");
      expect(hash(a2)).toBe(hash(a));      // determinism: rendering is a pure function of the frame number
      expect(hash(b)).not.toBe(hash(a));   // and frames do change over time
      let lit = 0;
      for (let i = 0; i < a.length; i += 4) if (a[i]! > 120) lit++;
      expect(lit).toBeGreaterThan(500);   // something brighter than the background was drawn
    } finally { await r.close(); }
  }, 60_000);

  it("renders shader generators and effect chains", async () => {
    const track = analyzeSignal(signal, { sampleRate: SR, fps: 30 });
    const r = await openRenderer(fxProject, "draft", { mix: track, bass: track }, { gpu: false });
    try {
      const px = await r.frame(40);
      let lit = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i + 1]! > 100) lit++;
      expect(lit).toBeGreaterThan(1000);
    } finally { await r.close(); }
  }, 60_000);

  it("a frame with trails looks the same whether rendered in sequence or jumped to (lead-in)", async () => {
    const track = analyzeSignal(signal, { sampleRate: SR, fps: 30 });
    const hash = (x: Buffer) => createHash("sha1").update(x).digest("hex");
    const a = await openRenderer(fxProject, "draft", { mix: track, bass: track }, { gpu: false });
    const b = await openRenderer(fxProject, "draft", { mix: track, bass: track }, { gpu: false });
    try {
      let seq: Buffer = Buffer.alloc(0);
      for (let f = 0; f <= 45; f++) seq = await a.frame(f); // sequential, as in a full render
      const jumped = await b.frame(45);                       // straight to frame 45, as in an excerpt
      expect(hash(jumped)).toBe(hash(seq));
    } finally { await a.close(); await b.close(); }
  }, 120_000);

  it("encodes H.264 in the browser (WebCodecs) as an Annex B stream with SPS/PPS and a keyframe", async () => {
    const track = analyzeSignal(signal, { sampleRate: SR, fps: 30 });
    const r = await openRenderer(project, "draft", { mix: track, bass: track }, { gpu: false });
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
  }, 60_000);
});
