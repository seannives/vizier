import { describe, it, expect } from "vitest";
import { analyzeSignal, fft } from "../src/index.ts";

const SR = 48000, FPS = 30;
const sine = (hz: number, secs: number, amp = 0.5) =>
  Float32Array.from({ length: SR * secs }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

describe("fft", () => {
  it("puts a pure tone in the right bin", () => {
    const n = 1024, re = new Float32Array(n), im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 64 * i) / n);
    fft(re, im);
    const mags = Array.from(re, (r, k) => Math.hypot(r, im[k]!)).slice(0, n / 2);
    expect(mags.indexOf(Math.max(...mags))).toBe(64);
  });
});

describe("analyzeSignal", () => {
  it("produces one frame per video frame", () => {
    const t = analyzeSignal(sine(440, 2), { sampleRate: SR, fps: FPS });
    expect(t.frameCount).toBe(60);
    expect(t.spectrum.length).toBe(60 * t.bins);
  });

  it("routes a 60 Hz tone to the low band and a 6 kHz tone to the high band", () => {
    const lo = analyzeSignal(sine(60, 1), { sampleRate: SR, fps: FPS }).scalars;
    const hi = analyzeSignal(sine(6000, 1), { sampleRate: SR, fps: FPS }).scalars;
    expect(mean(lo.low)).toBeGreaterThan(mean(lo.high) + 0.3);
    expect(mean(hi.high)).toBeGreaterThan(mean(hi.low) + 0.3);
  });

  it("centroid rises with pitch (tracks a filter sweep)", () => {
    const c = (hz: number) => mean(analyzeSignal(sine(hz, 1), { sampleRate: SR, fps: FPS }).scalars.centroid.slice(5, 25));
    expect(c(200)).toBeLessThan(c(1000));
    expect(c(1000)).toBeLessThan(c(5000));
  });

  it("detects onsets of a click train at the right frames", () => {
    const secs = 4, sig = new Float32Array(SR * secs);
    const hitTimes = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5];
    for (const t of hitTimes) {
      const s = Math.round(t * SR);
      for (let i = 0; i < 2400; i++) sig[s + i] = 0.8 * Math.exp(-i / 300) * Math.sin((2 * Math.PI * 100 * i) / SR);
    }
    const tr = analyzeSignal(sig, { sampleRate: SR, fps: FPS });
    const onsetFrames = tr.scalars.onset.flatMap((v, f) => (v ? [f] : []));
    expect(onsetFrames.length).toBe(hitTimes.length);
    onsetFrames.forEach((f, i) => expect(Math.abs(f - hitTimes[i]! * FPS)).toBeLessThanOrEqual(1));
  });

  it("is deterministic", () => {
    const a = analyzeSignal(sine(110, 1), { sampleRate: SR, fps: FPS });
    const b = analyzeSignal(sine(110, 1), { sampleRate: SR, fps: FPS });
    expect(a).toEqual(b);
  });
});
