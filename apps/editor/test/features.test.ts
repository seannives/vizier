import { describe, it, expect } from "vitest";
import { featureAt, contribution } from "../src/app/lib/features.ts";

const track = (scalars: Record<string, number[]>) => ({ version: 1 as const, fps: 10, frameCount: 20, bins: 1, scalars: scalars as any, spectrum: [] });

describe("features for the modulation meters", () => {
  it("reads a feature at a time, as the renderer does", () => {
    const tr = { bass: track({ env: Array.from({ length: 20 }, (_, i) => i / 20) }) };
    expect(featureAt(tr, "bass", "env", 0.5)).toBe(5 / 20);
    expect(featureAt(tr, "bass", "env", 99)).toBe(19 / 20); // past the end: the last frame
    expect(featureAt(tr, "nope", "env", 1)).toBe(0);
    expect(featureAt(null, "bass", "env", 1)).toBe(0);
  });
  it("hit is 1 at an onset, fading over 0.3 s", () => {
    const onset = Array(20).fill(0); onset[5] = 1;
    const tr = { d: track({ onset }) };
    expect(featureAt(tr, "d", "hit", 0.4)).toBe(0);
    expect(featureAt(tr, "d", "hit", 0.5)).toBe(1);
    expect(featureAt(tr, "d", "hit", 0.6)).toBeCloseTo(Math.exp(-1));
    expect(featureAt(tr, "d", "hit", 0.9)).toBe(0);
  });
  it("what a modulation adds, by curve", () => {
    expect(contribution({ amount: 60 }, 0.5)).toBe(30);
    expect(contribution({ amount: 60, curve: "square" }, 0.5)).toBe(15);
    expect(contribution({ amount: 60, curve: "sqrt" }, 0.25)).toBe(30);
    expect(contribution({ amount: -2 }, 1)).toBe(-2);
  });
});
