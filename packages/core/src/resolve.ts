import { evaluateLane, laneToSeconds, normalizeLane, isColorLane, colorLaneToSeconds, evaluateColorLane, type Lane, type ColorLane } from "./automation.ts";
import type { Modulation, Project } from "./project.ts";

export type FeatureLookup = (stem: string, feature: string) => number;

/**
 * The parameter stack: base value → automation lane → audio modulation → live override.
 * Pure: the same (time, features, overrides) always gives the same values.
 */
export class ParamResolver {
  private lanes = new Map<string, Lane>();
  private colorLanes = new Map<string, ColorLane>();
  private mods = new Map<string, Modulation[]>();
  overrides = new Map<string, number>();

  constructor(project: Project) {
    for (const l of project.automation ?? []) {
      if (isColorLane(l)) this.colorLanes.set(l.target, colorLaneToSeconds(l, project.grid));
      else this.lanes.set(l.target, normalizeLane(laneToSeconds(l, project.grid)));
    }
    for (const m of project.modulations ?? []) {
      const list = this.mods.get(m.target) ?? [];
      list.push(m);
      this.mods.set(m.target, list);
    }
  }

  value(target: string, base: number, t: number, features: FeatureLookup): number {
    const ov = this.overrides.get(target);
    if (ov !== undefined) return ov;
    const lane = this.lanes.get(target);
    let v = lane ? evaluateLane(lane, t) ?? base : base;
    for (const m of this.mods.get(target) ?? []) {
      const [stem, feat] = m.source.split(".") as [string, string];
      let x = features(stem, feat);
      if (m.curve === "square") x = x * x; else if (m.curve === "sqrt") x = Math.sqrt(Math.max(0, x));
      v += m.amount * x;
    }
    return v;
  }

  /** A colour target ("palette.<slot>" or "<layer>.<colour>"): its lane's value at t, else `base`. */
  color(target: string, base: string, t: number): string {
    const lane = this.colorLanes.get(target);
    return (lane && evaluateColorLane(lane, t)) || base;
  }
  hasColorLane(target: string): boolean { return this.colorLanes.has(target); }
}
