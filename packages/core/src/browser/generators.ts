import { lineRadial, curveCardinalClosed } from "d3-shape";
import { scaleLinear } from "d3-scale";

/** What a generator gets each frame. Everything it needs is here, so drawing is a pure function of it. */
export interface DrawContext {
  ctx: CanvasRenderingContext2D;
  w: number; h: number;              // layer size in pixels
  t: number; frame: number; fps: number;
  /** Resolved parameter (base → automation → modulation → override). */
  p(name: string, fallback: number): number;
  /** Scalar feature of this layer's stem (or another stem), optionally from k frames ago. */
  f(feature: string, framesAgo?: number, stem?: string): number;
  spectrum(framesAgo?: number, stem?: string): number[];
  rng: () => number;
  palette: Record<string, string>;
  text: string;
  font: string;
}

export interface Generator { id: string; draw(g: DrawContext): void }

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: string, b: string, u: number, alpha = 1) => {
  const x = hexToRgb(a), y = hexToRgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i]! - v) * Math.min(1, Math.max(0, u))));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
};

/** A ring traced by the stem's spectrum, with echoes of recent frames. Built for a 303: colour follows the filter. */
const acidRing: Generator = {
  id: "acidRing",
  draw(g) {
    const { ctx, w, h } = g;
    const m = Math.min(w, h);
    const echoes = Math.round(g.p("echoes", 10));
    const spacing = Math.max(1, Math.round(g.p("echoSpacing", 2)));
    const baseR = 0.22 * m * g.p("radius", 1);
    const spike = g.p("spike", 0.3) * m;
    const spin = g.p("spin", 0.05);
    const acid = g.p("acid", 1);
    const lineW = g.p("lineWidth", 2) * (m / 1080);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.globalCompositeOperation = "lighter";
    for (let k = echoes; k >= 0; k--) {
      const ago = k * spacing;
      const spec = g.spectrum(ago);
      const env = g.f("env", ago);
      const cen = g.f("centroid", ago);
      const pts = [...spec, ...[...spec].reverse()]; // mirror so the shape is symmetric and closes cleanly
      const ang = scaleLinear().domain([0, pts.length]).range([0, 2 * Math.PI]);
      const rot = g.t * spin * 2 * Math.PI - ago * 0.01;
      const line = lineRadial<number>()
        .angle((_, i) => ang(i) + rot)
        .radius((v) => baseR * (1 + 0.35 * env) * (1 + k * 0.035) + spike * Math.pow(v, 2.2))
        .curve(curveCardinalClosed.tension(0.3))
        .context(ctx);
      const fade = Math.pow(1 - k / (echoes + 1), 2);
      ctx.beginPath();
      line(pts);
      ctx.strokeStyle = mix(g.palette.ink ?? "#FCFCFB", g.palette.acid ?? "#B6FF3B", cen * 1.6 * acid, 0.85 * fade);
      ctx.lineWidth = lineW * (k === 0 ? 1.8 : 1);
      ctx.stroke();
    }
    // flash on onsets: a thin ring that expands over a few frames
    for (let k = 0; k < 8; k++) {
      if (g.f("onset", k) > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, baseR * (0.6 + k * 0.12), 0, 2 * Math.PI);
        ctx.strokeStyle = mix(g.palette.ink ?? "#FCFCFB", g.palette.acid ?? "#B6FF3B", acid, 0.5 * (1 - k / 8));
        ctx.lineWidth = lineW * 0.75;
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  },
};

/** A field of dots that breathes with the stem's low end and lights up on onsets. */
const pulseGrid: Generator = {
  id: "pulseGrid",
  draw(g) {
    const { ctx, w, h } = g;
    const step = Math.max(8, (Math.min(w, h) / g.p("density", 18)));
    const low = g.f("low"), env = g.f("env");
    let flash = 0;
    for (let k = 0; k < 6; k++) if (g.f("onset", k) > 0) { flash = 1 - k / 6; break; }
    const cx = w / 2, cy = h / 2, maxD = Math.hypot(cx, cy);
    const wave = g.p("wave", 1);
    ctx.fillStyle = g.palette.ink ?? "#FCFCFB";
    for (let y = step / 2; y < h; y += step) {
      for (let x = step / 2; x < w; x += step) {
        const d = Math.hypot(x - cx, y - cy) / maxD;
        const ripple = 0.5 + 0.5 * Math.sin(d * 14 - g.t * 3 * wave);
        const r = step * 0.08 * (0.4 + 1.6 * low * ripple) * (1 + flash * (1 - d));
        ctx.globalAlpha = Math.min(1, (0.08 + 0.35 * env * ripple + 0.3 * flash * (1 - d)) * g.p("brightness", 1));
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  },
};

/** Typewriter text: reveal (typing), shake, stutter and blur, all automatable. */
const typeText: Generator = {
  id: "typeText",
  draw(g) {
    const { ctx, w, h } = g;
    const size = g.p("size", 0.35) * h;
    const reveal = Math.min(1, Math.max(0, g.p("reveal", 1)));
    const shake = g.p("shake", 0) * size * 0.08;
    const stutter = g.p("stutter", 0);
    const blur = g.p("blur", 0) * (size / 40);
    const chars = Math.round(g.text.length * reveal);
    const shown = g.text.slice(0, chars);
    if (!shown) return;
    ctx.font = `${size}px ${g.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = g.palette.ink ?? "#FCFCFB";
    if (blur > 0.05) ctx.filter = `blur(${blur.toFixed(2)}px)`;
    const sx = (g.rng() - 0.5) * 2 * shake, sy = (g.rng() - 0.5) * 2 * shake;
    // a blinking caret while typing
    const caret = reveal < 1 && Math.floor(g.t * 2) % 2 === 0 ? "_" : "";
    ctx.fillText(shown + caret, w / 2 + sx, h / 2 + sy);
    // stutter: re-print the line with horizontal slices displaced, on onsets or at random
    if (stutter > 0 && (g.f("onset") > 0 || g.rng() < stutter * 0.25)) {
      const slices = 3 + Math.floor(g.rng() * 4);
      for (let i = 0; i < slices; i++) {
        const y0 = h / 2 - size / 2 + g.rng() * size;
        const sh = size * (0.05 + g.rng() * 0.15);
        const dx = (g.rng() - 0.5) * size * stutter * 1.5;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, y0, w, sh);
        ctx.clip();
        ctx.globalAlpha = 0.8;
        ctx.fillText(shown, w / 2 + dx, h / 2 + sy);
        ctx.restore();
      }
    }
    ctx.filter = "none";
  },
};

export const GENERATORS: Record<string, Generator> = Object.fromEntries([acidRing, pulseGrid, typeText].map((gen) => [gen.id, gen]));
