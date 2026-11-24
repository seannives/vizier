/** The effect registry. To add an effect: create a folder exporting defineEffect({...}), then add one line here. */
import type { EffectDef } from "../plugins.ts";
import glow from "./glow/index.ts";
import trails from "./trails/index.ts";
import rgbSplit from "./rgbSplit/index.ts";
import kaleidoscope from "./kaleidoscope/index.ts";

export const EFFECTS: Record<string, EffectDef> = Object.fromEntries([glow, trails, rgbSplit, kaleidoscope].map((e) => [e.id, e]));
