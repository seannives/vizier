/** Colour helpers for Canvas 2D generators. Blends happen in OKLCH (see ../color.ts). */
import { mixHex, parseHex } from "../color.ts";

export const rgba = (hex: string, alpha = 1) => {
  const [r, g, b] = parseHex(hex);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${alpha})`;
};
export const mix = (a: string, b: string, u: number, alpha = 1) => rgba(mixHex(a, b, Math.min(1, Math.max(0, u))), alpha);
