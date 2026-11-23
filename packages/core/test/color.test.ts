import { describe, it, expect } from "vitest";
import { hexToOklch, oklchToHex, mixHex, mixOklch, shiftColor, oklchToRgb } from "../src/color.ts";
import { evaluateColorLane, colorLaneToSeconds } from "../src/automation.ts";
import { ParamResolver, validateProject, normalizePalette, type Project } from "../src/index.ts";

describe("OKLCH", () => {
  it("matches reference values", () => {
    const [L, C, h] = hexToOklch("#ff0000"); // sRGB red: L 0.628, C 0.258, h 29.2 (Ottosson)
    expect(L).toBeCloseTo(0.628, 3); expect(C).toBeCloseTo(0.2577, 3); expect(h).toBeCloseTo(29.23, 1);
    expect(hexToOklch("#ffffff")[0]).toBeCloseTo(1, 4);
    expect(hexToOklch("#000000")[0]).toBeCloseTo(0, 4);
  });
  it("round-trips colours", () => {
    for (const hex of ["#2b2420", "#fcfcfb", "#b6ff3b", "#e0533a", "#5b8cff", "#808080"]) expect(oklchToHex(hexToOklch(hex))).toBe(hex);
  });
  it("blends without the muddy dip of RGB: lightness moves evenly", () => {
    const a = hexToOklch("#ff0000"), b = hexToOklch("#0000ff");
    const mid = hexToOklch(mixHex("#ff0000", "#0000ff", 0.5));
    expect(mid[0]).toBeCloseTo((a[0] + b[0]) / 2, 2);
    expect(mid[1]).toBeGreaterThan(0.2); // still vivid (an RGB blend gives a dull purple)
  });
  it("takes the short way round the hue circle, and greys borrow the other hue", () => {
    expect(mixOklch([0.6, 0.1, 350], [0.6, 0.1, 10], 0.5)[2]).toBeCloseTo(0, 6);
    expect(mixOklch([0.6, 0, 0], [0.6, 0.2, 140], 0.5)[2]).toBeCloseTo(140, 6);
  });
  it("brings out-of-gamut colours back by reducing chroma, keeping lightness", () => {
    const rgb = oklchToRgb([0.7, 0.4, 150]);
    for (const c of rgb) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); }
    expect(hexToOklch(oklchToHex([0.7, 0.4, 150]))[0]).toBeCloseTo(0.7, 2);
  });
  it("hue shift and lightness", () => {
    const [, , h0] = hexToOklch("#e0533a");
    expect(hexToOklch(shiftColor("#e0533a", 120, 0))[2]).toBeCloseTo((h0 + 120) % 360, 0);
    expect(shiftColor("#e0533a", 0, 1)).toBe("#ffffff");
    expect(shiftColor("#e0533a", 0, -1)).toBe("#000000");
    expect(shiftColor("#e0533a", 0, 0)).toBe("#e0533a");
  });
});

describe("colour lanes", () => {
  const lane = colorLaneToSeconds({ target: "palette.accent", points: [{ t: 0, c: "#ff0000" }, { t: 10, c: "#0000ff", curve: "hold" }, { t: 20, c: "#00ff00" }] });
  it("blends between colour breakpoints and holds", () => {
    expect(evaluateColorLane(lane, -1)).toBe("#ff0000");
    expect(evaluateColorLane(lane, 5)).toBe(mixHex("#ff0000", "#0000ff", 0.5));
    expect(evaluateColorLane(lane, 15)).toBe("#0000ff");
    expect(evaluateColorLane(lane, 30)).toBe("#00ff00");
  });
  const project: Project = {
    version: 2, title: "t", seed: 1, tracks: { mix: "m.wav" }, mix: "mix", palette: { acid: "#b6ff3b" },
    layers: [{ id: "ring", generator: "acidRing", z: 1, colors: { line: "extra1" }, layout: { landscape: { x: 0.5, y: 0.5, w: 1, h: 1 } } }],
    automation: [{ target: "palette.accent", points: [{ t: 0, c: "#000000" }, { t: 2, c: "#ffffff" }] }],
  };
  it("the resolver gives lane colours and falls back to the base", () => {
    const r = new ParamResolver(project);
    expect(r.color("palette.accent", "#123456", 2)).toBe("#ffffff");
    expect(r.color("ring.line", "#123456", 2)).toBe("#123456");
  });
  it("old palette name 'acid' maps to 'accent'; defaults fill the other slots", () => {
    const p = normalizePalette({ acid: "#b6ff3b" });
    expect(p.accent).toBe("#b6ff3b");
    expect(Object.keys(p)).toEqual(["bg", "ink", "accent", "extra1", "extra2", "acid"].filter((k) => k !== "acid"));
  });
  it("validates colour targets, values and points", () => {
    expect(validateProject(project)).toEqual([]);
    const bad: Project = {
      ...project,
      layers: [{ ...project.layers[0]!, colors: { nope: "#ffffff", line: "mauve" } }],
      automation: [{ target: "palette.purple", points: [{ t: 0, c: "#fff" }] }, { target: "ring.line", points: [{ t: 0, v: 1 }] }],
    };
    const e = validateProject(bad).join("\n");
    expect(e).toMatch(/"nope" is not a colour of acidRing/);
    expect(e).toMatch(/colour "line" must be #rrggbb or a palette slot/);
    expect(e).toMatch(/"palette.purple" isn't a colour/);
    expect(e).toMatch(/c: "#rrggbb"/);
    expect(e).toMatch(/"ring.line" is a colour: give its points c/);
  });
});

describe("the long way round", () => {
  it("fades green to red through blue instead of yellow, keeping brightness and vividness", () => {
    const g = hexToOklch("#33CC33"), r = hexToOklch("#CC3333");
    const short = mixOklch(g, r, 0.5), long = mixOklch(g, r, 0.5, true);
    const between = (h: number, a: number, b: number) => h > Math.min(a, b) && h < Math.max(a, b);
    expect(between(short[2], r[2], g[2])).toBe(true);                     // via yellow/orange: between them
    expect(between(long[2], r[2], g[2])).toBe(false);                     // the other way: blue and purple
    expect(long[2]).toBeGreaterThan(200);
    expect(long[2]).toBeLessThan(330);
    expect(long[0]).toBeCloseTo(short[0], 5);
    expect(mixOklch(g, r, 0, true)).toEqual(g);
    expect(mixOklch(g, r, 1, true)[2]).toBeCloseTo(r[2], 5);
  });
  it("a colour lane point with hue: long fades that way to the next point", () => {
    const lane = colorLaneToSeconds({ target: "palette.accent", points: [{ t: 0, c: "#33CC33", hue: "long" }, { t: 1, c: "#CC3333" }] });
    const mid = hexToOklch(evaluateColorLane(lane, 0.5)!);
    expect(mid[2]).toBeGreaterThan(200);
    expect(mid[2]).toBeLessThan(330);
  });
});
