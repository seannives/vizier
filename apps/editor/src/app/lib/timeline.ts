/** Timeline maths: time ↔ pixels, and bars snapped to beats. */
import { barToSeconds, secondsToBar, type Grid } from "../../../../../packages/core/src/index.ts";

export interface View { start: number; pxPerSec: number } // seconds at the left edge, zoom

export const xOf = (t: number, v: View) => (t - v.start) * v.pxPerSec;
export const tOf = (x: number, v: View) => v.start + x / v.pxPerSec;

/** Nearest beat to a bar position (bars are 1-based, fractional). */
export function snapToBeat(bar: number, grid: Grid): number {
  const segs = [...grid.tempo].sort((a, b) => a.bar - b.bar);
  const seg = segs.filter((s) => s.bar <= bar).pop() ?? segs[0]!;
  const bpb = seg.beatsPerBar ?? 4;
  return seg.bar + Math.round((bar - seg.bar) * bpb) / bpb;
}

export const snapTime = (t: number, grid: Grid) => barToSeconds(snapToBeat(secondsToBar(t, grid), grid), grid);

/** Seconds per beat at time t. */
export function beatSeconds(t: number, grid: Grid): number {
  const bar = secondsToBar(t, grid);
  const segs = [...grid.tempo].sort((a, b) => a.bar - b.bar);
  const seg = segs.filter((s) => s.bar <= bar).pop() ?? segs[0]!;
  return 60 / seg.bpm;
}
