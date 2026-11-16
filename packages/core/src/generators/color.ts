/** Small colour helpers shared by Canvas 2D generators. */
export const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const mix = (a: string, b: string, u: number, alpha = 1) => {
  const x = hexToRgb(a), y = hexToRgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i]! - v) * Math.min(1, Math.max(0, u))));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
};
export const ink = (p: Record<string, string>) => p.ink ?? "#FCFCFB";
export const acid = (p: Record<string, string>) => p.acid ?? "#B6FF3B";
export const bg = (p: Record<string, string>) => p.bg ?? "#2B2420";
