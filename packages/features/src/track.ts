import { FrameAnalyzer, type AnalyzerOptions, type FeatureFrame } from "./analyzer.ts";

export const SCALAR_FEATURES = ["rms", "env", "low", "lowMid", "mid", "high", "centroid", "flux", "onset"] as const;
export type ScalarFeature = (typeof SCALAR_FEATURES)[number];

/** Features for a whole stem, one entry per video frame. Plain arrays so it serialises to JSON. */
export interface FeatureTrack {
  version: 1;
  fps: number;
  frameCount: number;
  bins: number;
  scalars: Record<ScalarFeature, number[]>;
  spectrum: number[]; // frameCount * bins, row-major
}

/** Analyse a mono signal at video frame rate. Frame i is centred on time i / fps. */
export function analyzeSignal(samples: Float32Array, opts: AnalyzerOptions): FeatureTrack {
  const an = new FrameAnalyzer(opts);
  const n = an.fftSize;
  const frameCount = Math.floor((samples.length / opts.sampleRate) * opts.fps);
  const scalars = Object.fromEntries(SCALAR_FEATURES.map((k) => [k, new Array<number>(frameCount)])) as Record<ScalarFeature, number[]>;
  const spectrum = new Array<number>(frameCount * an.bins);
  const buf = new Float32Array(n);
  for (let f = 0; f < frameCount; f++) {
    const centre = Math.round((f / opts.fps) * opts.sampleRate);
    const start = centre - n / 2;
    for (let i = 0; i < n; i++) { const j = start + i; buf[i] = j >= 0 && j < samples.length ? samples[j]! : 0; }
    const fr: FeatureFrame = an.process(buf);
    for (const k of SCALAR_FEATURES) scalars[k][f] = round4(fr[k]);
    for (let b = 0; b < an.bins; b++) spectrum[f * an.bins + b] = round4(fr.spectrum[b]!);
  }
  return { version: 1, fps: opts.fps, frameCount, bins: an.bins, scalars, spectrum };
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Read one frame back out of a track (clamped to its ends). */
export function frameAt(track: FeatureTrack, frame: number): { scalars: Record<ScalarFeature, number>; spectrum: number[] } {
  const f = Math.min(track.frameCount - 1, Math.max(0, frame | 0));
  const scalars = Object.fromEntries(SCALAR_FEATURES.map((k) => [k, track.scalars[k][f] ?? 0])) as Record<ScalarFeature, number>;
  return { scalars, spectrum: track.spectrum.slice(f * track.bins, (f + 1) * track.bins) };
}
