import { describe, it, expect } from "vitest";
import { frameAtOrAfter } from "../src/frames.ts";
import { positionToSeconds } from "../../../packages/core/src/index.ts";

describe("the frame for a time", () => {
  it("is the first frame at or after it, so a still at a bar shows that bar", () => {
    // bar 81 at 155 bpm is 123.871 s: frame 3716 (123.867 s) is just before the downbeat, 3717 just after
    const grid = { tempo: [{ bar: 1, bpm: 155, beatsPerBar: 4 }], downbeat: 0 };
    expect(frameAtOrAfter(positionToSeconds({ bar: 81 }, grid), 30)).toBe(3717);
  });
  it("a time exactly on a frame is that frame, despite rounding", () => {
    expect(frameAtOrAfter(0.1 * 3, 30)).toBe(9); // 0.30000000000000004 s
    expect(frameAtOrAfter(0, 30)).toBe(0);
  });
});
