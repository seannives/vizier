/**
 * Geometry for moving, resizing and rotating a layer on the preview. A transform is centre-anchored, in fractions
 * of the frame (x, y from the top left; w, h of the frame's width and height), and `rotation` is in degrees,
 * counter-clockwise on screen (as the renderer draws it). Pointer positions are in pixels of the shown frame.
 */
import type { Transform } from "../../../../../packages/core/src/index.ts";

export interface Frame { W: number; H: number; safe?: { x: number; y: number; w: number; h: number } }
export interface Guide { axis: "x" | "y"; at: number } // a snapped line, as a fraction of the frame
type Pt = { x: number; y: number };

const rad = (deg: number) => (deg * Math.PI) / 180;
/** Screen offset from the centre (y down) → the layer's own unrotated frame, and back. */
export function toLocal(d: Pt, rotation = 0): Pt {
  const a = rad(rotation), c = Math.cos(a), s = Math.sin(a);
  return { x: d.x * c - d.y * s, y: d.x * s + d.y * c };
}
export const toScreen = (l: Pt, rotation = 0): Pt => toLocal(l, -rotation);

/** Is the pixel point inside the layer's (rotated) box? */
export function contains(t: Transform, f: Frame, p: Pt): boolean {
  const l = toLocal({ x: p.x - t.x * f.W, y: p.y - t.y * f.H }, t.rotation ?? 0);
  return Math.abs(l.x) <= (t.w * f.W) / 2 && Math.abs(l.y) <= (t.h * f.H) / 2;
}

/** Lines a layer snaps to: the frame's edges and centre, and the safe area's edges and centre. */
export function snapLines(f: Frame): { x: number[]; y: number[] } {
  const x = [0, 0.5, 1], y = [0, 0.5, 1];
  if (f.safe) {
    x.push(f.safe.x, f.safe.x + f.safe.w, f.safe.x + f.safe.w / 2);
    y.push(f.safe.y, f.safe.y + f.safe.h, f.safe.y + f.safe.h / 2);
  }
  return { x, y };
}
/** The smallest shift (fraction) that puts one of `edges` on one of `lines`, within `tol`; or null. */
function nearest(edges: number[], lines: number[], tol: number): { shift: number; at: number } | null {
  let best: { shift: number; at: number } | null = null;
  for (const e of edges) for (const l of lines) {
    const d = l - e;
    if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.shift))) best = { shift: d, at: l };
  }
  return best;
}

export const SNAP_PX = 6;

/** Move by a pixel offset from where the drag started. Snaps the box's edges or centre to the snap lines (only
 *  the centre when rotated) unless `free`. */
export function moved(orig: Transform, dx: number, dy: number, f: Frame, free = false): { t: Transform; guides: Guide[] } {
  const t = { ...orig, x: orig.x + dx / f.W, y: orig.y + dy / f.H };
  const guides: Guide[] = [];
  if (free) return { t, guides };
  const lines = snapLines(f);
  const rotated = Math.abs(orig.rotation ?? 0) > 0.01;
  const ex = rotated ? [t.x] : [t.x - t.w / 2, t.x, t.x + t.w / 2];
  const ey = rotated ? [t.y] : [t.y - t.h / 2, t.y, t.y + t.h / 2];
  const sx = nearest(ex, lines.x, SNAP_PX / f.W), sy = nearest(ey, lines.y, SNAP_PX / f.H);
  if (sx) { t.x += sx.shift; guides.push({ axis: "x", at: sx.at }); }
  if (sy) { t.y += sy.shift; guides.push({ axis: "y", at: sy.at }); }
  return { t, guides };
}

/**
 * Resize by dragging a handle to pixel point `p`. The handle is (sx, sy) in {-1, 0, 1}: corners move two edges,
 * edge handles one. The opposite edge stays put, or with `fromCentre` the box grows evenly about its centre.
 * The dragged edges snap to the snap lines unless `free` or the box is rotated.
 */
export function resized(orig: Transform, handle: { sx: number; sy: number }, p: Pt, f: Frame, opts: { free?: boolean; fromCentre?: boolean } = {}): { t: Transform; guides: Guide[] } {
  const r = orig.rotation ?? 0;
  const C = { x: orig.x * f.W, y: orig.y * f.H };
  const hw = (orig.w * f.W) / 2, hh = (orig.h * f.H) / 2;
  const l = toLocal({ x: p.x - C.x, y: p.y - C.y }, r);
  const guides: Guide[] = [];
  const snapAxis = !opts.free && Math.abs(r) < 0.01;
  const lines = snapLines(f);
  const MIN = 4;
  const axis = (s: number, lp: number, half: number, size: number, centre: number, ls: number[], name: "x" | "y") => {
    if (s === 0) return { a: -half, b: half };
    let edge = lp;
    if (snapAxis) { // snap the dragged edge (in frame fractions; not rotated, so local = screen axis)
      const n = nearest([(centre + edge) / size], ls, SNAP_PX / size);
      if (n) { edge = n.at * size - centre; guides.push({ axis: name, at: n.at }); }
    }
    const fixed = opts.fromCentre ? -edge : -s * half;
    let a = Math.min(edge, fixed), b = Math.max(edge, fixed);
    if (b - a < MIN) { if (s > 0) b = a + MIN; else a = b - MIN; }
    return { a, b };
  };
  const X = axis(handle.sx, l.x, hw, f.W, C.x, lines.x, "x");
  const Y = axis(handle.sy, l.y, hh, f.H, C.y, lines.y, "y");
  const lc = toScreen({ x: (X.a + X.b) / 2, y: (Y.a + Y.b) / 2 }, r);
  return { t: { ...orig, x: (C.x + lc.x) / f.W, y: (C.y + lc.y) / f.H, w: (X.b - X.a) / f.W, h: (Y.b - Y.a) / f.H }, guides };
}

/** Rotate by dragging the knob from `p0` to `p` (pixels) around the box's centre; snaps to 15° steps unless `free`. */
export function rotated(orig: Transform, p0: Pt, p: Pt, f: Frame, free = false): Transform {
  const C = { x: orig.x * f.W, y: orig.y * f.H };
  const a0 = Math.atan2(p0.y - C.y, p0.x - C.x), a1 = Math.atan2(p.y - C.y, p.x - C.x);
  // screen angles grow clockwise (y down); rotation is counter-clockwise
  let r = (orig.rotation ?? 0) - ((a1 - a0) * 180) / Math.PI;
  if (!free) r = Math.round(r / 15) * 15;
  r = ((((r + 180) % 360) + 360) % 360) - 180;
  return { ...orig, rotation: Math.abs(r) < 1e-9 ? 0 : r };
}
