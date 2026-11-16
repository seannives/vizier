/**
 * The generator registry. To add a visual: create a folder with an index.ts that default-exports
 * defineGenerator({...}), then add one line here. See docs/adding-a-generator.md.
 */
import type { Generator } from "../plugins.ts";
import acidRing from "./acidRing/index.ts";
import pulseGrid from "./pulseGrid/index.ts";
import typeText from "./typeText/index.ts";
import ridgeline from "./ridgeline/index.ts";
import flowField from "./flowField/index.ts";

export const GENERATORS: Record<string, Generator> = Object.fromEntries(
  [acidRing, pulseGrid, typeText, ridgeline, flowField].map((g) => [g.id, g]),
);
