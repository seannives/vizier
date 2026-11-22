/**
 * The plugin format for visuals. A generator draws a layer; an effect transforms a layer's image.
 * Both declare their parameters, which drive validation, automation targets and (soon) the editor's controls.
 * Definitions are plain data plus a draw function or GLSL source, safe to import in Node.
 */

export type ParamType = "number" | "int" | "toggle";

/** The palette: five colour slots per song (a video can override them). Colours default to these. */
export const PALETTE_SLOTS = [
  { id: "bg", label: "Background", default: "#2B2420" },
  { id: "ink", label: "Ink", default: "#FCFCFB" },
  { id: "accent", label: "Accent", default: "#B6FF3B" },
  { id: "extra1", label: "Extra 1", default: "#E0533A" },
  { id: "extra2", label: "Extra 2", default: "#5B8CFF" },
] as const;
export type PaletteSlot = (typeof PALETTE_SLOTS)[number]["id"];
export const isPaletteSlot = (s: string): s is PaletteSlot => PALETTE_SLOTS.some((x) => x.id === s);
/** Older project files used "acid" for the accent colour. */
export const PALETTE_ALIASES: Record<string, PaletteSlot> = { acid: "accent" };

/** A colour a generator draws with. It follows a palette slot unless the layer sets its own colour. */
export interface ColorSpec { name: string; label: string; default: PaletteSlot }

export interface ParamSpec {
  name: string;          // used in automation targets: "<layer>.<name>" or "<layer>.<effect>.<name>"
  label: string;
  type?: ParamType;      // default "number"; "toggle" is 0 or 1
  min: number;
  max: number;           // the UI range; audio modulation may push a value beyond it
  default: number;
  description?: string;
  /** A size in pixels of the full-size video: a smaller preview scales it down, so the preview matches the export. */
  pixels?: boolean;
}

/** What a Canvas 2D generator gets each frame. Drawing must be a pure function of this. */
export interface DrawContext {
  ctx: CanvasRenderingContext2D;
  w: number; h: number;              // layer size in pixels
  t: number; frame: number; fps: number;
  /** Resolved parameter value (base → automation → modulation → override). */
  p(name: string): number;
  /** One of the generator's declared colours, as "#rrggbb" (palette or layer colour, automated, hue/lightness applied). */
  color(name: string): string;
  /** Scalar feature of this layer's stem (or another stem), optionally from k frames ago. */
  f(feature: string, framesAgo?: number, stem?: string): number;
  spectrum(framesAgo?: number, stem?: string): number[];
  rng: () => number;
  /** The palette at this moment (slot → "#rrggbb"). Prefer declared colours via `color()`. */
  palette: Record<string, string>;
  text: string;
  font: string;
}

interface PluginBase {
  id: string;
  label: string;
  description: string;
  params: ParamSpec[];
  colors?: ColorSpec[];
}

export interface Canvas2DGenerator extends PluginBase {
  kind: "canvas2d";
  usesText?: boolean;
  draw(g: DrawContext): void;
}

/**
 * A GLSL generator. `fragment` is the body of a function `vec4 generate(vec2 uv)` returning premultiplied RGBA.
 * Available: uv (0..1, y up), u_res (layer pixels), u_aspect, u_time, u_frame, u_seed;
 * features of the layer's stem: u_rms u_env u_low u_lowMid u_mid u_high u_centroid u_flux u_onset,
 * u_hit (onset envelope that decays over ~0.3 s), spec(bin01, framesAgo01) (spectrum history, 64 frames);
 * each declared colour as vec3 u_<name>; the palette as u_pal_<slot>; each parameter as u_<name>;
 * helpers hash21, noise, fbm.
 */
export interface ShaderGenerator extends PluginBase {
  kind: "shader";
  fragment: string;
}

export type Generator = Canvas2DGenerator | ShaderGenerator;

/**
 * An effect: one or more GLSL passes over a layer's image. Each pass's `fragment` is the body of
 * `vec4 pass(vec2 uv)` (uv in texture space). Available: u_in (previous pass), u_orig (effect input),
 * u_fb (this effect's previous output, if `feedback`), u_texel, u_res, u_time, u_fps, parameters as u_<name>.
 */
export interface EffectDef extends PluginBase {
  passes: string[];
  feedback?: boolean;
}

export const defineGenerator = <G extends Generator>(g: G): G => g;
export const defineEffect = (e: EffectDef): EffectDef => e;

/** Parameters every layer has, handled by the compositor. */
export const LAYER_PARAMS: ParamSpec[] = [
  { name: "opacity", label: "Opacity", min: 0, max: 1, default: 1 },
  { name: "x", label: "X (centre)", min: 0, max: 1, default: 0.5 },
  { name: "y", label: "Y (centre)", min: 0, max: 1, default: 0.5 },
  { name: "w", label: "Width", min: 0, max: 2, default: 1 },
  { name: "h", label: "Height", min: 0, max: 2, default: 1 },
  { name: "rotation", label: "Rotation (degrees)", min: -180, max: 180, default: 0 },
  { name: "hueShift", label: "Hue shift (degrees)", min: -180, max: 180, default: 0, description: "Rotates all of the layer's colours" },
  { name: "lightness", label: "Lightness", min: -1, max: 1, default: 0, description: "−1 black … 0 as is … +1 white, for all of the layer's colours" },
  { name: "softEdge", label: "Soft edge", min: 0, max: 0.5, default: 0, description: "Fades the layer out towards the edges of its box, so trails and glow that reach the box don't end in a straight line. The width of the fade, as a fraction of the box's shorter side" },
];

/** Global post-processing parameters, automatable as "post.<name>". */
export const POST_PARAMS: ParamSpec[] = [
  { name: "grain", label: "Film grain", min: 0, max: 0.3, default: 0.05 },
  { name: "vignette", label: "Vignette", min: 0, max: 1, default: 0.55 },
];

export const defaults = (specs: ParamSpec[]): Record<string, number> => Object.fromEntries(specs.map((s) => [s.name, s.default]));
