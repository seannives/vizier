/**
 * When a layer is on. A layer with no spans is on for the whole song. Spans are in bars (`to` exclusive, like the
 * video range: 1–49 is bars 1..48); fades are in beats, inside the span (a fade-in starts at `from`, a fade-out ends
 * at `to`). A layer that's off isn't drawn at all, and its feedback effects (trails) start fresh when it comes on.
 */
import { barToSeconds, secondsToBar, type Grid } from "./grid.ts";

export interface Span {
  from: number;          // bar where the layer comes on
  to?: number;           // bar where it goes off (exclusive); open-ended when missing
  fadeIn?: number;       // beats
  fadeOut?: number;      // beats
}

/** A span in seconds, fades as seconds. */
export interface SpanSec { from: number; to: number; fadeIn: number; fadeOut: number }

const beatsPerBar = (grid: Grid, bar: number) => {
  const seg = [...grid.tempo].sort((a, b) => a.bar - b.bar).filter((s) => s.bar <= bar).pop() ?? grid.tempo[0];
  return seg?.beatsPerBar ?? 4;
};

export function spansToSeconds(spans: Span[], grid: Grid): SpanSec[] {
  return spans.map((s) => {
    const from = barToSeconds(s.from, grid);
    const to = s.to === undefined ? Infinity : barToSeconds(s.to, grid);
    const fadeIn = s.fadeIn ? barToSeconds(s.from + s.fadeIn / beatsPerBar(grid, s.from), grid) - from : 0;
    const toBar = s.to ?? s.from;
    const fadeOut = s.fadeOut && s.to !== undefined ? to - barToSeconds(toBar - s.fadeOut / beatsPerBar(grid, toBar), grid) : 0;
    return { from, to, fadeIn: Math.max(0, fadeIn), fadeOut: Math.max(0, fadeOut) };
  }).sort((a, b) => a.from - b.from);
}

/** How much the layer is on at time t: 0 (off) … 1 (on). `undefined` spans: always on. Overlapping spans: the most. */
export function spanGain(spans: SpanSec[] | undefined, t: number): number {
  if (!spans) return 1;
  let g = 0;
  for (const s of spans) {
    if (t < s.from || t >= s.to) continue;
    let v = 1;
    if (s.fadeIn > 0) v = Math.min(v, (t - s.from) / s.fadeIn);
    if (s.fadeOut > 0) v = Math.min(v, (s.to - t) / s.fadeOut);
    g = Math.max(g, Math.min(1, Math.max(0, v)));
  }
  return g;
}

/** Split the span containing `bar` in two at `bar` (fades stay at the outer ends). Returns the spans unchanged if
 *  no span contains it, or it's at a span's edge. */
export function splitSpans(spans: Span[], bar: number): Span[] {
  const i = spans.findIndex((s) => bar > s.from + 1e-9 && (s.to === undefined || bar < s.to - 1e-9));
  if (i < 0) return spans;
  const s = spans[i]!;
  const a: Span = { from: s.from, to: bar, ...(s.fadeIn ? { fadeIn: s.fadeIn } : {}) };
  const b: Span = { from: bar, ...(s.to !== undefined ? { to: s.to } : {}), ...(s.fadeOut ? { fadeOut: s.fadeOut } : {}) };
  return [...spans.slice(0, i), a, b, ...spans.slice(i + 1)];
}

export function validateSpans(spans: Span[], grid: Grid | undefined, where: string): string[] {
  const errs: string[] = [];
  if (spans.length && !grid) errs.push(`${where}: on-spans are in bars and need a tempo (song grid)`);
  for (const s of spans) {
    if (s.to !== undefined && s.to <= s.from) errs.push(`${where}: span ${s.from}–${s.to} ends before it starts`);
    if ((s.fadeIn ?? 0) < 0 || (s.fadeOut ?? 0) < 0) errs.push(`${where}: fades can't be negative`);
  }
  return errs;
}

/** For the editor: spans as seconds → bars, rounded to 1/1000 bar. */
export const secondsToSpanBar = (t: number, grid: Grid) => Math.round(secondsToBar(t, grid) * 1000) / 1000;
