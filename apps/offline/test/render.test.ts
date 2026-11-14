// Renders real frames in headless Chrome (software GL). Skipped when no Chrome is available.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { analyzeSignal } from "../../../packages/features/src/index.ts";
import type { Project } from "../../../packages/core/src/index.ts";
import { openRenderer } from "../src/browser.ts";

const chrome = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const run = existsSync(chrome) ? describe : describe.skip;
process.env.CHROME_PATH ??= chrome;

const SR = 48000;
const signal = Float32Array.from({ length: SR * 2 }, (_, i) => (i % 12000 < 2000 ? 0.6 : 0.1) * Math.sin((2 * Math.PI * 55 * i) / SR));
const project: Project = {
  version: 1, title: "test", seed: 7, stems: { main: "x", bass: "x" },
  palette: { bg: "#2B2420", ink: "#FCFCFB", acid: "#B6FF3B" },
  layers: [
    { id: "grid", stem: "main", generator: "pulseGrid", z: 0, layout: { landscape: { x: 0.5, y: 0.5, w: 1, h: 1 } } },
    { id: "bass", stem: "bass", generator: "acidRing", z: 1, blend: "add", layout: { landscape: { x: 0.5, y: 0.5, w: 0.56, h: 1 } } },
    { id: "title", generator: "typeText", z: 2, text: "test", params: { shake: 1, stutter: 1 }, layout: { landscape: { x: 0.5, y: 0.85, w: 0.6, h: 0.15 } } },
  ],
};

run("renderer in headless Chrome", () => {
  it("draws non-blank frames, and the same frame twice is byte-identical", async () => {
    const track = analyzeSignal(signal, { sampleRate: SR, fps: 30 });
    const r = await openRenderer(project, "draft", { main: track, bass: track }, { gpu: false });
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
});
