import { describe, it, expect } from "vitest";
import { smoothClock } from "../src/app/lib/transport.ts";

describe("smoothClock (the playhead clock)", () => {
  // an audio clock that runs true on average but reads ±4 ms off, updated only every 10 ms (like an audio buffer)
  const jittery = (ms: number) => Math.floor(ms / 10) * 0.01 + (((ms * 7919) % 9) - 4) / 1000;

  it("moves evenly at 60 fps despite a jittery, steppy audio clock, and never backwards", () => {
    let c = smoothClock(null, 0, 0);
    let worst = 0;
    for (let i = 1; i < 600; i++) {
      const now = i * (1000 / 60);
      const prev = c.t;
      c = smoothClock(c, jittery(now), now);
      const step = c.t - prev;
      expect(step).toBeGreaterThanOrEqual(0);
      if (i > 60) worst = Math.max(worst, Math.abs(step - 1 / 60));
    }
    expect(worst).toBeLessThan(0.002); // frame-to-frame steps within 2 ms of a true 1/60 s
    expect(Math.abs(c.t - 599 / 60)).toBeLessThan(0.01); // and still on time
  });
  it("catches up with a small sync change gradually, and takes a jump at once", () => {
    let c = smoothClock(null, 1, 0);
    for (let i = 1; i <= 60; i++) c = smoothClock(c, 1 + i / 60 + 0.03, i * (1000 / 60)); // 30 ms later
    expect(c.t - 2).toBeGreaterThan(0.025);
    c = smoothClock(c, 10, 61 * (1000 / 60));
    expect(c.t).toBe(10);
  });
});
