import { barToSeconds, type Grid } from "./grid.ts";
import { mixHex } from "./color.ts";
/**
 * Automation, modelled on Ableton's: a lane is a list of breakpoints for one target parameter.
 * A breakpoint is placed either in seconds (`t`) or in bars (`bar`, 1-based like Live: bar 33 = the first beat
 * of bar 33, 33.5 = halfway through it). Bars need the song's grid (see grid.ts). Lanes are converted to seconds on load.
 */
export type Curve = "linear" | "hold" | "smooth";

export interface Breakpoint { t: number; v: number; curve?: Curve } // curve applies to the segment AFTER this point
/** A breakpoint as written in a project file: a number `v`, or for colour lanes a colour `c` ("#rrggbb"). */
export interface BreakpointInput { t?: number; bar?: number; v?: number; c?: string; curve?: Curve }
export interface ColorBreakpoint { t: number; c: string; curve?: Curve }
export interface ColorLane { target: string; points: ColorBreakpoint[] }
export interface LaneInput { target: string; points: BreakpointInput[] }

/** Resolve a position given as `t` (seconds) or `bar` to seconds. */
export function positionToSeconds(p: { t?: number; bar?: number }, grid?: Grid): number {
  if (p.t !== undefined) return p.t;
  if (p.bar !== undefined) {
    if (!grid) throw new Error("A position in bars needs the song's grid (tempo)");
    return barToSeconds(p.bar, grid);
  }
  throw new Error("A position needs t (seconds) or bar");
}

export function laneToSeconds(lane: LaneInput, grid?: Grid): Lane {
  return { target: lane.target, points: lane.points.map((p) => ({ t: positionToSeconds(p, grid), v: p.v ?? 0, ...(p.curve ? { curve: p.curve } : {}) })) };
}

export const isColorLane = (lane: LaneInput) => lane.points.some((p) => p.c !== undefined);

export function colorLaneToSeconds(lane: LaneInput, grid?: Grid): ColorLane {
  const points = lane.points.map((p) => ({ t: positionToSeconds(p, grid), c: p.c ?? "#000000", ...(p.curve ? { curve: p.curve } : {}) }));
  return { target: lane.target, points: points.sort((a, b) => a.t - b.t) };
}

/** Colour at time t: breakpoints blended in OKLCH, with the same curves as number lanes. */
export function evaluateColorLane(lane: ColorLane, t: number): string | undefined {
  const pts = lane.points;
  if (!pts.length) return undefined;
  if (t <= pts[0]!.t) return pts[0]!.c;
  const last = pts[pts.length - 1]!;
  if (t >= last.t) return last.c;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid]!.t <= t) lo = mid; else hi = mid; }
  const a = pts[lo]!, b = pts[hi]!;
  const curve = a.curve ?? "linear";
  if (curve === "hold") return a.c;
  let u = (t - a.t) / (b.t - a.t);
  if (curve === "smooth") u = u * u * (3 - 2 * u);
  return mixHex(a.c, b.c, u);
}
export interface Lane { target: string; points: Breakpoint[] }

export function evaluateLane(lane: Lane, t: number): number | undefined {
  const pts = lane.points;
  if (pts.length === 0) return undefined;
  if (t <= pts[0]!.t) return pts[0]!.v;
  const last = pts[pts.length - 1]!;
  if (t >= last.t) return last.v;
  // binary search for the segment containing t
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid]!.t <= t) lo = mid; else hi = mid; }
  const a = pts[lo]!, b = pts[hi]!;
  const curve = a.curve ?? "linear";
  if (curve === "hold") return a.v;
  let u = (t - a.t) / (b.t - a.t);
  if (curve === "smooth") u = u * u * (3 - 2 * u);
  return a.v + (b.v - a.v) * u;
}

/** Validate and sort a lane (breakpoints must have finite times; equal times allowed for jumps). */
export function normalizeLane(lane: Lane): Lane {
  for (const p of lane.points) if (!Number.isFinite(p.t) || !Number.isFinite(p.v)) throw new Error(`Bad breakpoint in lane ${lane.target}`);
  return { target: lane.target, points: [...lane.points].sort((a, b) => a.t - b.t) };
}

/**
 * Turn a recorded stream of control moves (from a live performance) into a lane,
 * dropping points that a straight line through their neighbours already predicts.
 */
export function thinRecording(target: string, samples: { t: number; v: number }[], tolerance = 0.01): Lane {
  if (samples.length <= 2) return { target, points: samples.map((s) => ({ ...s })) };
  const keep = new Array(samples.length).fill(false);
  keep[0] = keep[samples.length - 1] = true;
  const rdp = (i: number, j: number) => {
    const a = samples[i]!, b = samples[j]!;
    let worst = -1, worstErr = tolerance;
    for (let k = i + 1; k < j; k++) {
      const s = samples[k]!;
      const pred = a.v + ((b.v - a.v) * (s.t - a.t)) / (b.t - a.t || 1);
      const err = Math.abs(s.v - pred);
      if (err > worstErr) { worstErr = err; worst = k; }
    }
    if (worst >= 0) { keep[worst] = true; rdp(i, worst); rdp(worst, j); }
  };
  rdp(0, samples.length - 1);
  return { target, points: samples.filter((_, i) => keep[i]).map((s) => ({ ...s })) };
}
