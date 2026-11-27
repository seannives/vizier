import { defineGenerator, type DrawContext } from "../../plugins.ts";
import { rgba } from "../color.ts";

/**
 * Text in Special Elite: a title, a caption or a card. Several lines (Return in the text), wrapping to the box,
 * alignment, shrinking to fit, and an optional panel behind it; with a typing reveal, shake, slice stutter and blur,
 * all automatable. With the defaults it's one centred line with no panel.
 */
export default defineGenerator({
  id: "typeText",
  label: "Text",
  description: "Text in Special Elite: a title, caption or card, with an optional panel behind it; typing reveal, shake, stutter and blur.",
  kind: "canvas2d",
  usesText: true,
  colors: [
    { name: "text", label: "Text", default: "ink" },
    { name: "panel", label: "Panel", default: "bg" },
  ],
  params: [
    { name: "size", label: "Size (of layer height)", min: 0.05, max: 1, default: 0.35, description: "Letter height as a share of the layer's height. Make the layer wider than the text needs." },
    { name: "reveal", label: "Typed (0–1)", min: 0, max: 1, default: 1, description: "How much of the text is shown: automate 0 → 1 to type it out. A caret blinks while typing." },
    { name: "shake", label: "Shake", min: 0, max: 3, default: 0, description: "Random jitter of the whole text, every frame (the same in every render)." },
    { name: "stutter", label: "Stutter", min: 0, max: 2, default: 0, description: "Glitch: horizontal strips of the text slide sideways on hits, and sometimes in between." },
    { name: "blur", label: "Blur", min: 0, max: 20, default: 0, description: "Softens the letters; automate it down to bring text into focus." },
    { name: "align", label: "Align (0 left, 1 centre, 2 right)", type: "int", min: 0, max: 2, default: 1, description: "Where lines sit across the box: 0 left, 1 centred, 2 right (inside the padding)." },
    { name: "wrap", label: "Wrap", type: "toggle", min: 0, max: 1, default: 0, description: "Break long lines at spaces to fit the box's width. Off: each line (Return in the text) stays one line." },
    { name: "fit", label: "Shrink to fit", type: "toggle", min: 0, max: 1, default: 0, description: "Make the letters smaller, if needed, so all the text fits inside the box (and its padding)." },
    { name: "lineSpacing", label: "Line spacing", min: 0.8, max: 2.5, default: 1.2, description: "Distance from one line to the next, in letter heights." },
    { name: "panel", label: "Panel", min: 0, max: 1, default: 0, description: "A filled panel behind the text, the size of the layer's box: its opacity. 0: no panel." },
    { name: "padding", label: "Padding", min: 0, max: 0.4, default: 0.06, description: "Space between the box's edge and the text, as a share of the box's shorter side." },
    { name: "corner", label: "Panel corners", min: 0, max: 0.5, default: 0.05, description: "How rounded the panel's corners are, as a share of the box's shorter side. 0: square." },
  ],
  draw(g) {
    const { ctx, w, h } = g;
    const pad = g.p("padding") * Math.min(w, h);
    const panel = Math.min(1, Math.max(0, g.p("panel")));
    if (panel > 0.001) {
      ctx.save();
      ctx.globalAlpha = panel;
      ctx.fillStyle = rgba(g.color("panel"));
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, Math.min(w, h) * Math.min(0.5, g.p("corner")));
      ctx.fill();
      ctx.restore();
    }
    let size = g.p("size") * h;
    const spacing = g.p("lineSpacing");
    const wrap = g.p("wrap") >= 0.5, fit = g.p("fit") >= 0.5;
    const maxW = Math.max(1, w - 2 * pad), maxH = Math.max(1, h - 2 * pad);
    ctx.font = `${size}px ${g.font}`;
    let lines = layout(ctx, g.text, wrap ? maxW : Infinity);
    // shrink to fit: measure, scale, wrap again at the new size (a few rounds settle it)
    if (fit) for (let k = 0; k < 6; k++) {
      const bw = Math.max(1, ...lines.map((l) => ctx.measureText(l).width)), bh = size * (1 + spacing * (lines.length - 1));
      const s = Math.min(1, maxW / bw, maxH / bh);
      if (s > 0.995) break;
      size *= s;
      ctx.font = `${size}px ${g.font}`;
      lines = layout(ctx, g.text, wrap ? maxW : Infinity);
    }
    const reveal = Math.min(1, Math.max(0, g.p("reveal")));
    const total = lines.reduce((n, l) => n + l.length, 0);
    let left = Math.round(total * reveal);
    if (!left) return;
    const shake = g.p("shake") * size * 0.08;
    const stutter = g.p("stutter");
    const blur = g.p("blur") * (size / 40);
    const align = Math.round(g.p("align"));
    ctx.textAlign = align === 0 ? "left" : align === 2 ? "right" : "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = rgba(g.color("text"));
    if (blur > 0.05) ctx.filter = `blur(${blur.toFixed(2)}px)`;
    const x0 = align === 0 ? pad : align === 2 ? w - pad : w / 2;
    const lineH = size * spacing;
    const y0 = h / 2 - (lineH * (lines.length - 1)) / 2;
    const sx = (g.rng() - 0.5) * 2 * shake, sy = (g.rng() - 0.5) * 2 * shake;
    // the lines as typed so far, a caret after the last character while typing
    const shown: { text: string; y: number }[] = [];
    lines.forEach((l, i) => {
      if (left <= 0) return;
      const part = l.slice(0, left);
      left -= l.length;
      shown.push({ text: part, y: y0 + i * lineH });
    });
    const caret = reveal < 1 && Math.floor(g.t * 2) % 2 === 0 ? "_" : "";
    shown.forEach((s, i) => ctx.fillText(s.text + (i === shown.length - 1 ? caret : ""), x0 + sx, s.y + sy));
    if (stutter > 0 && (g.f("onset") > 0 || g.rng() < stutter * 0.25)) {
      const top = y0 - size / 2, bottom = y0 + lineH * (lines.length - 1) + size / 2;
      const slices = 3 + Math.floor(g.rng() * 4);
      for (let i = 0; i < slices; i++) {
        const ys = top + g.rng() * (bottom - top);
        const sh = size * (0.05 + g.rng() * 0.15);
        const dx = (g.rng() - 0.5) * size * stutter * 1.5;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, ys, w, sh);
        ctx.clip();
        ctx.globalAlpha = 0.8;
        for (const s of shown) ctx.fillText(s.text, x0 + dx, s.y + sy);
        ctx.restore();
      }
    }
    ctx.filter = "none";
  },
});

/** The text as lines: its own lines (Return), each broken at spaces to fit `maxW` (a word too long for a line is
 *  broken where it must be). */
function layout(ctx: DrawContext["ctx"], text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (!Number.isFinite(maxW) || ctx.measureText(para).width <= maxW) { out.push(para); continue; }
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= maxW) { line = next; continue; }
      if (line) out.push(line);
      line = word;
      while (ctx.measureText(line).width > maxW && line.length > 1) { // a single word wider than the box
        let n = line.length - 1;
        while (n > 1 && ctx.measureText(line.slice(0, n)).width > maxW) n--;
        out.push(line.slice(0, n));
        line = line.slice(n);
      }
    }
    out.push(line);
  }
  return out;
}
