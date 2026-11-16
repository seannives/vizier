/**
 * Listening aids for setting up a project: tempo, where bar 1 starts, where each track plays,
 * and likely section changes. Suggestions only: a person (or Claude) confirms them.
 */
import { analyzeSignal, type FeatureTrack } from "../../../packages/features/src/index.ts";

export const ANALYSIS_FPS = 100;

export interface TempoGuess { bpm: number; score: number }
export interface Analysis {
  duration: number;
  tempo: TempoGuess[];             // best first; includes half/double-time alternatives
  bpm: number;
  downbeat: number;                // seconds: suggested start of bar 1
  beatsPerBar: number;
  bars: number;                    // complete bars after the downbeat
  tracks: { id: string; active: [number, number][]; levels: number[] }[]; // levels: mean loudness per bar (0–1)
  sectionChanges: { bar: number; strength: number }[];
}

/** Value of a series at a fractional index (linear interpolation). */
const at = (a: number[], x: number) => {
  const i = Math.floor(x), f = x - i;
  if (i < 0 || i + 1 >= a.length) return 0;
  return a[i]! * (1 - f) + a[i + 1]! * f;
};

export function estimateTempo(flux: number[], fps: number, lo = 70, hi = 190): TempoGuess[] {
  const x = flux.map((v) => v - flux.reduce((s, y) => s + y, 0) / flux.length);
  const scores: TempoGuess[] = [];
  for (let b10 = lo * 10; b10 <= hi * 10; b10++) {
    const bpm = b10 / 10, period = (fps * 60) / bpm;
    let s = 0;
    for (let k = 1; k <= 8; k++) {
      const lag = k * period, i = Math.floor(lag), f = lag - i;
      let dot = 0;
      for (let n = 0; n + i + 1 < x.length; n++) dot += x[n]! * (x[n + i]! * (1 - f) + x[n + i + 1]! * f);
      s += dot;
    }
    scores.push({ bpm, score: s });
  }
  // local maxima, best first
  const peaks = scores.filter((s, i) => (i === 0 || s.score >= scores[i - 1]!.score) && (i === scores.length - 1 || s.score >= scores[i + 1]!.score));
  peaks.sort((a, b) => b.score - a.score);
  const top = peaks[0]!.score || 1;
  return peaks.slice(0, 5).map((p) => ({ bpm: p.bpm, score: Math.round((p.score / top) * 100) / 100 }));
}

export function analyze(tracks: { id: string; samples: Float32Array }[], mixId: string, sampleRate: number, opts: { bpm?: number; beatsPerBar?: number } = {}): Analysis {
  const fps = ANALYSIS_FPS;
  const feats = new Map<string, FeatureTrack>(tracks.map((t) => [t.id, analyzeSignal(t.samples, { sampleRate, fps })]));
  const mix = feats.get(mixId) ?? [...feats.values()][0]!;
  const flux = mix.scalars.flux;
  const tempo = estimateTempo(flux, fps);
  const bpm = opts.bpm ?? tempo[0]!.bpm;
  const bpb = opts.beatsPerBar ?? 4;
  const P = (fps * 60) / bpm;

  // Beat phase: where beats land on the strongest attacks, weighting the low end (kicks, bass) over hats,
  // which in dance music often sit on the off-beat.
  const low = mix.scalars.low;
  const lowAttack = low.map((v, i) => Math.max(0, v - (low[i - 1] ?? v)));
  const norm = (a: number[]) => { const m = Math.max(...a) || 1; return a.map((v) => v / m); };
  const fluxN = norm(flux), lowN = norm(lowAttack);
  const onset = fluxN.map((v, i) => 0.4 * v + lowN[i]!);
  let bestPhase = 0, bestScore = -Infinity;
  for (let ph = 0; ph < P; ph += 0.25) {
    let s = 0;
    for (let x = ph; x < onset.length; x += P) s += at(onset, x);
    if (s > bestScore) { bestScore = s; bestPhase = ph; }
  }
  // downbeat: the beat in the bar with the most low-end attack (kicks and bass land on the one)
  let bestBeat = 0, bestLow = -Infinity;
  for (let j = 0; j < bpb; j++) {
    let s = 0;
    for (let x = bestPhase + j * P; x < lowN.length; x += bpb * P) s += at(lowN, x);
    if (s > bestLow) { bestLow = s; bestBeat = j; }
  }
  const barLen = bpb * P;
  const firstDownbeat = (bestPhase + bestBeat * P) % barLen;
  // bar 1: the first downbeat at or after the music starts (allowing half a beat of slop)
  const env = mix.scalars.env;
  const startFrame = Math.max(0, env.findIndex((v) => v > 0.3));
  let d = firstDownbeat;
  while (d < startFrame - P / 2) d += barLen;
  const downbeat = d / fps;
  const duration = mix.frameCount / fps;
  const bars = Math.floor((mix.frameCount - d) / barLen);

  const perBar = (series: number[]) => Array.from({ length: bars }, (_, b) => {
    const a = Math.round(d + b * barLen), z = Math.round(d + (b + 1) * barLen);
    let s = 0; for (let i = a; i < z; i++) s += series[i] ?? 0;
    return s / Math.max(1, z - a);
  });
  const trackOut = tracks.map((t) => {
    const levels = perBar(feats.get(t.id)!.scalars.rms).map((v) => Math.round(v * 100) / 100);
    const active: [number, number][] = [];
    levels.forEach((v, b) => {
      const on = v > 0.25;
      const last = active[active.length - 1];
      if (on && last && last[1] === b + 1) last[1] = b + 2;
      else if (on) active.push([b + 1, b + 2]);
    });
    return { id: t.id, active: active.map(([a, z]) => [a, z - 1] as [number, number]), levels };
  });

  // section changes: how different the 4 bars after a bar line are from the 4 before, across all tracks' bands
  const bandSeries = [...feats.values()].flatMap((f) => ["low", "lowMid", "mid", "high"].map((k) => perBar((f.scalars as Record<string, number[]>)[k]!)));
  const novelty: number[] = Array.from({ length: bars }, (_, b) => {
    if (b < 2 || b > bars - 2) return 0;
    let s = 0;
    for (const ser of bandSeries) {
      const before = ser.slice(Math.max(0, b - 4), b), after = ser.slice(b, Math.min(bars, b + 4));
      const m = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
      s += (m(after) - m(before)) ** 2;
    }
    return Math.sqrt(s);
  });
  const mean = novelty.reduce((a, b) => a + b, 0) / novelty.length;
  const sd = Math.sqrt(novelty.reduce((a, b) => a + (b - mean) ** 2, 0) / novelty.length);
  const changes = novelty
    .map((v, b) => ({ bar: b + 1, v }))
    .filter(({ v }, i) => v > mean + 0.5 * sd && v >= (novelty[i - 1] ?? 0) && v >= (novelty[i + 1] ?? 0))
    .map(({ bar, v }) => ({ bar, strength: Math.round(((v - mean) / (sd || 1)) * 10) / 10 }));

  return { duration, tempo, bpm, downbeat: Math.round(downbeat * 1000) / 1000, beatsPerBar: bpb, bars, tracks: trackOut, sectionChanges: changes };
}
