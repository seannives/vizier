import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startEncoder, fadeFilter, writeCover } from "../src/encode.ts";

describe("the cover image", () => {
  it("is a JPEG at the best quality that stays under the size limit", () => {
    const dir = mkdtempSync(join(tmpdir(), "vizier-cover-"));
    try {
      const W = 640, H = 360, px = Buffer.alloc(W * H * 4);
      let seed = 1;
      for (let i = 0; i < px.length; i++) px[i] = (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 23; // noise: hard to compress
      const best = writeCover(px, W, H, join(dir, "a.jpg"), 4e6);
      expect(best).toBe(2);
      const big = readFileSync(join(dir, "a.jpg")).length;
      const q = writeCover(px, W, H, join(dir, "b.jpg"), big * 0.6);
      expect(q).toBeGreaterThan(2);
      expect(readFileSync(join(dir, "b.jpg")).length).toBeLessThanOrEqual(big * 0.6);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("audio fades in the video file", () => {
  it("builds no filter without fades, and one for each fade", () => {
    expect(fadeFilter({ duration: 10 })).toEqual([]);
    expect(fadeFilter({ duration: 10, fadeIn: 0.01, fadeOut: 0.5 })).toEqual(["-af", "afade=t=in:st=0:d=0.0100,afade=t=out:st=9.5000:d=0.5000"]);
  });
  it("fades a cut-out stretch of the song in and out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vizier-fade-"));
    try {
      // a steady tone, 6 s; render 2 s of it from 1 s with a 0.5 s fade-in and a 1 s fade-out
      const tone = join(dir, "tone.wav"), out = join(dir, "out.mp4");
      expect(spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=6:sample_rate=48000", tone]).status).toBe(0);
      const W = 32, H = 32, fps = 10;
      const enc = startEncoder({ out, width: W, height: H, fps, audio: tone, audioStart: 1, duration: 2, fadeIn: 0.5, fadeOut: 1 });
      for (let i = 0; i < 20; i++) await enc.write(Buffer.alloc(W * H * 4));
      await enc.finish();
      const pcm = spawnSync("ffmpeg", ["-v", "error", "-i", out, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 1 << 26 }).stdout;
      const s = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
      // loudness (RMS) of 50 ms windows at a time
      const rms = (t: number) => { const a = Math.floor(t * 48000), n = 2400; let q = 0; for (let i = a; i < a + n; i++) q += (s[i] ?? 0) ** 2; return Math.sqrt(q / n); };
      const full = rms(0.75);
      expect(full).toBeGreaterThan(0.05); // (ffmpeg's sine is at 1/8 amplitude)
      expect(rms(0.0)).toBeLessThan(full * 0.15);    // starts near silence
      expect(rms(0.25)).toBeLessThan(full * 0.75);   // half way through the fade-in
      expect(rms(0.25)).toBeGreaterThan(full * 0.25);
      expect(rms(1.45)).toBeLessThan(full * 0.75);   // half way through the fade-out
      expect(rms(1.92)).toBeLessThan(full * 0.15);   // ends near silence
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 30_000);
});
