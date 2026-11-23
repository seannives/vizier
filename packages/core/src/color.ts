/**
 * Colour maths in OKLCH, a perceptual colour space (Björn Ottosson's Oklab, in polar form):
 * L = lightness 0–1, C = chroma (vividness, 0 = grey), h = hue in degrees.
 * Blending in OKLCH keeps brightness and vividness even through a fade, where RGB blends go dull or dark.
 */
export type Oklch = [number, number, number];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a colour: "${hex}" (expected #rrggbb)`);
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export const isHex = (s: string) => /^#[0-9a-f]{6}$/i.test(s);

export function toHex(rgb: [number, number, number]): string {
  return "#" + rgb.map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, "0")).join("");
}

/** sRGB (0–1, gamma-encoded) → OKLCH. */
export function rgbToOklch([r, g, b]: [number, number, number]): Oklch {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const h = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return [L, C, C < 1e-6 ? 0 : h];
}

/** OKLCH → linear-light sRGB, unclamped (may be out of gamut). */
function oklchToLinear([L, C, h]: Oklch): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

/** OKLCH → sRGB (0–1). Out-of-gamut colours keep their lightness and hue and lose chroma until they fit. */
export function oklchToRgb(c: Oklch): [number, number, number] {
  const L = clamp01(c[0]);
  let lin = oklchToLinear([L, c[1], c[2]]);
  if (!inGamut(lin)) {
    let lo = 0, hi = c[1];
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (inGamut(oklchToLinear([L, mid, c[2]]))) lo = mid; else hi = mid; }
    lin = oklchToLinear([L, lo, c[2]]);
  }
  return lin.map((x) => clamp01(toGamma(clamp01(x)))) as [number, number, number];
}

export const hexToOklch = (hex: string) => rgbToOklch(parseHex(hex));
export const oklchToHex = (c: Oklch) => toHex(oklchToRgb(c));

/** Blend two colours in OKLCH, the short way round the hue circle (or the long way: green to red through cyan, blue
 *  and purple instead of yellow); greys take the other colour's hue. */
export function mixOklch(a: Oklch, b: Oklch, u: number, long = false): Oklch {
  const t = clamp01(u);
  let ha = a[2], hb = b[2];
  if (a[1] < 1e-3) ha = hb;
  if (b[1] < 1e-3) hb = ha;
  let dh = hb - ha;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  if (long && a[1] >= 1e-3 && b[1] >= 1e-3) dh = dh > 0 ? dh - 360 : dh + 360;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (ha + dh * t + 360) % 360];
}

export const mixHex = (a: string, b: string, u: number, long = false) => oklchToHex(mixOklch(hexToOklch(a), hexToOklch(b), u, long));

/** Hue shift (degrees) and lightness offset (−1…1: −1 = black, +1 = white), applied in OKLCH. */
export function shiftColor(hex: string, hueShift: number, lightness: number): string {
  if (!hueShift && !lightness) return hex;
  const [L, C, h] = hexToOklch(hex);
  const l = lightness >= 0 ? L + (1 - L) * Math.min(1, lightness) : L * (1 + Math.max(-1, lightness));
  // as a colour approaches black or white it also loses vividness
  const c = C * (1 - Math.abs(Math.max(-1, Math.min(1, lightness))));
  return oklchToHex([l, c, ((h + hueShift) % 360 + 360) % 360]);
}
