import { describe, it, expect } from "vitest";
import { FrameStats } from "../src/stats.ts";

describe("FrameStats", () => {
  it("counts no drops at a steady 60 Hz", () => {
    const s = new FrameStats();
    for (let i = 0; i < 300; i++) s.frame(i * 16.667, 1);
    expect(s.summary().dropped).toBe(0);
    expect(s.summary().refreshHz).toBeCloseTo(60, 0);
  });
  it("counts the frames lost in a stall", () => {
    const s = new FrameStats();
    let t = 0;
    for (let i = 0; i < 100; i++) s.frame((t += 16.667), 1);
    s.frame((t += 16.667 * 13), 1); // a ~200 ms stall: 12 frames shown twice
    for (let i = 0; i < 50; i++) s.frame((t += 16.667), 1);
    expect(s.summary().dropped).toBe(12);
  });
});
