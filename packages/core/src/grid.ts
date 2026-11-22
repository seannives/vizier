/**
 * The beat grid: how bar numbers map to seconds in the audio.
 * - `tempo` is a list of segments; each starts at a bar and sets the BPM and beats per bar from there on.
 *   One entry covers a song with a steady tempo; more entries handle tempo or metre changes.
 * - `downbeat` is where bar 1 starts in the audio file, in seconds. Exports often begin before the first
 *   downbeat (a "breath" for streaming services); that lead-in is bar 0.x.
 * - `barLabelOffset` only changes how bars are *displayed* (e.g. 16 to match Live's arrangement, where the
 *   music starts at bar 17). Files always store vizier's own bar numbers.
 * Bars are 1-based and fractional: 33 is the first beat of bar 33, 33.5 halfway through it.
 */
export interface TempoSegment { bar: number; bpm: number; beatsPerBar?: number }
export interface Grid { tempo: TempoSegment[]; downbeat?: number; barLabelOffset?: number }

const segs = (g: Grid) => [...g.tempo].sort((a, b) => a.bar - b.bar);
const barSeconds = (s: TempoSegment) => ((s.beatsPerBar ?? 4) * 60) / s.bpm;

/** Seconds per bar at bar position x (the last segment starting at or before x; the first one before that). */
function secPerBar(x: number, s: TempoSegment[]): number {
  let cur = s[0]!;
  for (const seg of s) if (seg.bar <= x) cur = seg;
  return barSeconds(cur);
}

/** Seconds between bar positions a and b (a <= b), integrating over tempo segments. */
function span(a: number, b: number, s: TempoSegment[]): number {
  const cuts = s.slice(1).map((x) => x.bar).filter((x) => x > a && x < b);
  let t = 0, from = a;
  for (const c of [...cuts, b]) { t += (c - from) * secPerBar(from, s); from = c; }
  return t;
}

export function barToSeconds(bar: number, grid: Grid): number {
  const s = segs(grid);
  if (!s.length) throw new Error("The grid needs at least one tempo entry");
  const d = grid.downbeat ?? 0;
  return bar >= 1 ? d + span(1, bar, s) : d - span(bar, 1, s);
}

export function secondsToBar(sec: number, grid: Grid): number {
  const s = segs(grid);
  if (!s.length) throw new Error("The grid needs at least one tempo entry");
  let lo = -1000, hi = 100000; // bars; binary search on the monotonic mapping
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (barToSeconds(mid, grid) < sec) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** Beats per bar in effect at a bar position (the segment starting at or before it; the first one before that). */
export function beatsPerBarAt(bar: number, grid: Grid): number {
  const s = segs(grid);
  let cur = s[0];
  for (const seg of s) if (seg.bar <= bar + 1e-9) cur = seg;
  return cur?.beatsPerBar ?? 4;
}

/**
 * A bar position moved by a number of beats (negative: back), counting beats in the metre in effect along the way:
 * 4 beats back from bar 17 when bars 1–16 are in 4/4 is bar 16, whatever metre starts at 17.
 */
export function addBeats(bar: number, beats: number, grid: Grid): number {
  const s = segs(grid);
  let x = bar, left = Math.abs(beats);
  const fwd = beats >= 0;
  for (let guard = 0; left > 1e-12 && guard < 1000; guard++) {
    // the segment in effect in the direction of travel, and where it ends that way
    const inEffect = fwd ? beatsPerBarAt(x, grid) : beatsPerBarAt(x - 1e-6, grid); // (just before x, going back)
    const edge = fwd ? (s.find((seg) => seg.bar > x + 1e-9)?.bar ?? Infinity) : ([...s].reverse().find((seg) => seg.bar < x - 1e-6 && seg !== s[0])?.bar ?? -Infinity);
    const room = Math.abs(edge - x) * inEffect; // beats until that edge
    if (left <= room) { x += (fwd ? 1 : -1) * (left / inEffect); left = 0; }
    else { x = edge; left -= room; }
  }
  return x;
}

/** The next beat line strictly after (dir 1) or before (dir -1) a bar position, in the metre of each bar. */
export function nextBeatLine(bar: number, dir: 1 | -1, grid: Grid): number {
  const eps = 1e-6;
  const b = Math.floor(bar + eps);
  const bpb = beatsPerBarAt(b, grid);
  if (dir > 0) {
    const k = Math.floor((bar - b) * bpb + eps) + 1;
    return k >= bpb ? b + 1 : b + k / bpb;
  }
  const k = Math.ceil((bar - b) * bpb - eps) - 1;
  if (k >= 0) return b + k / bpb;
  const pb = beatsPerBarAt(b - 1, grid);
  return b - 1 + (pb - 1) / pb;
}

/** "17.3" style label (bar.beat), using the display offset. */
export function barLabel(bar: number, grid: Grid): string {
  const s = segs(grid).filter((x) => x.bar <= bar).pop() ?? segs(grid)[0]!;
  const bpb = s.beatsPerBar ?? 4;
  const whole = Math.floor(bar + 1e-9);
  const beat = Math.floor((bar - whole) * bpb + 1e-6) + 1;
  return `${whole + (grid.barLabelOffset ?? 0)}.${beat}`;
}

export function validateGrid(g: Grid): string[] {
  const errs: string[] = [];
  if (!g.tempo?.length) errs.push("grid.tempo needs at least one entry");
  const seen = new Set<number>();
  for (const s of g.tempo ?? []) {
    if (!(s.bpm > 0)) errs.push(`grid.tempo: bpm must be positive (bar ${s.bar})`);
    if (s.beatsPerBar !== undefined && !(s.beatsPerBar > 0)) errs.push(`grid.tempo: beatsPerBar must be positive (bar ${s.bar})`);
    if (seen.has(s.bar)) errs.push(`grid.tempo: two entries at bar ${s.bar}`);
    seen.add(s.bar);
  }
  if (g.downbeat !== undefined && !(g.downbeat >= 0)) errs.push("grid.downbeat must be ≥ 0 seconds");
  return errs;
}

/** The beats from `from` up to (not including) `to`, in seconds, with whether each starts a bar (for a click). */
export function beatTimes(from: number, to: number, grid: Grid): { t: number; bar: number; downbeat: boolean }[] {
  const out: { t: number; bar: number; downbeat: boolean }[] = [];
  // the first beat line at or after `from` (a hair before it, so a beat exactly at `from` counts)
  let b = nextBeatLine(secondsToBar(from, grid) - 1e-5, 1, grid);
  for (let guard = 0; guard < 10000; guard++) {
    const t = barToSeconds(b, grid);
    if (t >= to) break;
    if (t >= from - 1e-9) out.push({ t, bar: b, downbeat: Math.abs(b - Math.round(b)) < 1e-6 });
    b = nextBeatLine(b, 1, grid);
  }
  return out;
}
