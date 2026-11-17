import { describe, it, expect } from "vitest";
import { contains, moved, resized, rotated, toLocal, toScreen } from "../src/app/lib/layoutDrag.ts";

const f = { W: 1000, H: 500 };
const reel = { W: 540, H: 960, safe: { x: 0, y: (1920 - 1350) / 2 / 1920, w: 1, h: 1350 / 1920 } };
const box = { x: 0.5, y: 0.5, w: 0.2, h: 0.2, rotation: 0 }; // 200 × 100 px, centred

describe("layout dragging", () => {
  it("local and screen frames round-trip, and rotation is counter-clockwise on screen", () => {
    const p = toScreen({ x: 1, y: 0 }, 90);
    expect(p.x).toBeCloseTo(0); expect(p.y).toBeCloseTo(-1); // right of centre, rotated 90° CCW: straight up
    const l = toLocal(toScreen({ x: 3, y: -2 }, 37), 37);
    expect(l.x).toBeCloseTo(3); expect(l.y).toBeCloseTo(-2);
  });
  it("hit-tests the rotated box", () => {
    expect(contains(box, f, { x: 590, y: 250 })).toBe(true);
    expect(contains(box, f, { x: 500, y: 310 })).toBe(false);          // below a 100 px tall box (y 200–300)
    expect(contains({ ...box, rotation: 90 }, f, { x: 500, y: 310 })).toBe(true); // stood on end it reaches y 150–350
  });
  it("moves, snapping an edge or the centre to the frame's lines; ⇧ (free) doesn't snap", () => {
    const a = moved(box, 3, 0, f);                  // centre 3 px off the middle: snaps back
    expect(a.t.x).toBe(0.5);
    expect(a.guides).toEqual([{ axis: "x", at: 0.5 }, { axis: "y", at: 0.5 }]);
    const b = moved(box, -398, 0, f);               // left edge 2 px from the frame's left edge
    expect(b.t.x - b.t.w / 2).toBeCloseTo(0);
    expect(moved(box, 3, 0, f, true).t.x).toBeCloseTo(0.503);
  });
  it("snaps to the Reels safe area", () => {
    const top = reel.safe.y * reel.H;               // 142.5 px
    const r = moved({ x: 0.5, y: 0.3, w: 0.5, h: 0.1, rotation: 0 }, 0, top + 48 + 3 - 0.3 * 960, reel); // top edge 3 px below it
    expect((r.t.y - r.t.h / 2) * reel.H).toBeCloseTo(top);
  });
  it("resizes from a corner with the opposite corner fixed, or about the centre", () => {
    const r = resized(box, { sx: 1, sy: 1 }, { x: 640, y: 320 }, f, { free: true });
    expect(r.t.x - r.t.w / 2).toBeCloseTo(0.4);    // left edge stays at 400 px
    expect(r.t.w).toBeCloseTo(0.24);                 // 400 → 640 px
    expect(r.t.y - r.t.h / 2).toBeCloseTo(0.4);    // top edge stays at 200 px
    expect(r.t.h).toBeCloseTo(0.24);                 // 200 → 320 px
    const c = resized(box, { sx: 1, sy: 0 }, { x: 650, y: 999 }, f, { free: true, fromCentre: true });
    expect(c.t.x).toBeCloseTo(0.5); expect(c.t.w).toBeCloseTo(0.3); expect(c.t.h).toBeCloseTo(0.2);
  });
  it("resizes a rotated box along its own axes", () => {
    const rb = { ...box, rotation: 90 };              // 200 px wide box stood on end: its right edge is at the top
    const r = resized(rb, { sx: 1, sy: 0 }, { x: 500, y: 100 }, f, { free: true }); // drag that edge up to y = 100
    expect(r.t.w).toBeCloseTo(0.25);                 // left edge fixed 100 px below the centre (y = 350): 250 px
    expect(r.t.x).toBeCloseTo(0.5);
    expect(r.t.y * f.H).toBeCloseTo(225);            // the centre moved up, halfway between y = 100 and y = 350
  });
  it("rotates by dragging the knob, in 15° steps unless free", () => {
    // the knob above the centre, dragged to its left: a quarter turn counter-clockwise
    expect(rotated(box, { x: 500, y: 150 }, { x: 400, y: 250 }, f).rotation).toBe(90);
    expect(rotated(box, { x: 500, y: 150 }, { x: 600, y: 245 }, f).rotation).toBe(-90);
    expect(rotated(box, { x: 500, y: 150 }, { x: 510, y: 150 }, f).rotation).toBe(0);
    expect(rotated(box, { x: 500, y: 150 }, { x: 510, y: 150 }, f, true).rotation).toBeCloseTo(-5.71, 1);
  });
});
