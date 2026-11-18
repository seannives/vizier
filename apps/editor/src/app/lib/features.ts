/** Reading audio features at a moment, for the editor's live meters (the same values the renderer uses). */
import type { FeatureTrack } from "../../../../../packages/features/src/index.ts";
import type { Modulation } from "../../../../../packages/core/src/index.ts";

/** The features a modulation can follow, in plain words, in the order the menu shows them. */
export const FEATURES: { id: string; label: string; hint: string }[] = [
  { id: "env", label: "loudness (smoothed)", hint: "rises fast, falls slowly: things that should breathe" },
  { id: "rms", label: "loudness", hint: "raw level, frame by frame" },
  { id: "low", label: "low end", hint: "20–150 Hz: kick and sub" },
  { id: "lowMid", label: "low mids", hint: "150–600 Hz: bass body, toms" },
  { id: "mid", label: "mids", hint: "600 Hz – 3 kHz: vocals, leads" },
  { id: "high", label: "highs", hint: "3–16 kHz: hats, air" },
  { id: "centroid", label: "brightness / filter", hint: "where the sound's brightness sits: a 303's filter sweep" },
  { id: "flux", label: "change", hint: "how much the sound is changing" },
  { id: "hit", label: "hit (fading)", hint: "1 at a hit, fading over 0.3 s" },
  { id: "onset", label: "hits", hint: "1 on the frame a hit starts" },
];
export const CURVES: { id: NonNullable<Modulation["curve"]>; label: string; hint: string }[] = [
  { id: "linear", label: "linear", hint: "in proportion" },
  { id: "square", label: "peaks", hint: "only strong peaks move it much" },
  { id: "sqrt", label: "gentle", hint: "even quiet parts move it noticeably" },
];

/** A feature's value (0–1) on a track at time t (seconds), as the renderer reads it. */
export function featureAt(tracks: Record<string, FeatureTrack> | null, track: string, feature: string, t: number): number {
  const tr = tracks?.[track];
  if (!tr || t < 0) return 0;
  const at = (k: number) => {
    const i = Math.min(tr.frameCount - 1, Math.max(0, Math.round(t * tr.fps) - k));
    return i;
  };
  if (feature === "hit") { // onset envelope decaying over ~0.3 s
    const span = Math.round(0.3 * tr.fps);
    for (let k = 0; k <= span; k++) if (Math.round(t * tr.fps) - k >= 0 && ((tr.scalars as Record<string, number[]>).onset?.[at(k)] ?? 0) > 0) return Math.exp(-k / (span / 3));
    return 0;
  }
  return (tr.scalars as Record<string, number[]>)[feature]?.[at(0)] ?? 0;
}
/** What a modulation adds to its parameter for a feature value x. */
export function contribution(m: Pick<Modulation, "amount" | "curve">, x: number): number {
  const y = m.curve === "square" ? x * x : m.curve === "sqrt" ? Math.sqrt(Math.max(0, x)) : x;
  return m.amount * y;
}
