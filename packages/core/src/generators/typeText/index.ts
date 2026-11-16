import { defineGenerator } from "../../plugins.ts";
import { rgba } from "../color.ts";

/** Typewriter text: reveal (typing), shake, stutter and blur, all automatable. */
export default defineGenerator({
  id: "typeText",
  label: "Typewriter text",
  description: "The layer's text in Special Elite, with a typing reveal, shake, slice stutter and blur.",
  kind: "canvas2d",
  usesText: true,
  colors: [{ name: "text", label: "Text", default: "ink" }],
  params: [
    { name: "size", label: "Size (of layer height)", min: 0.05, max: 1, default: 0.35 },
    { name: "reveal", label: "Typed (0–1)", min: 0, max: 1, default: 1 },
    { name: "shake", label: "Shake", min: 0, max: 3, default: 0 },
    { name: "stutter", label: "Stutter", min: 0, max: 2, default: 0 },
    { name: "blur", label: "Blur", min: 0, max: 20, default: 0 },
  ],
  draw(g) {
    const { ctx, w, h } = g;
    const size = g.p("size") * h;
    const reveal = Math.min(1, Math.max(0, g.p("reveal")));
    const shake = g.p("shake") * size * 0.08;
    const stutter = g.p("stutter");
    const blur = g.p("blur") * (size / 40);
    const shown = g.text.slice(0, Math.round(g.text.length * reveal));
    if (!shown) return;
    ctx.font = `${size}px ${g.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = rgba(g.color("text"));
    if (blur > 0.05) ctx.filter = `blur(${blur.toFixed(2)}px)`;
    const sx = (g.rng() - 0.5) * 2 * shake, sy = (g.rng() - 0.5) * 2 * shake;
    const caret = reveal < 1 && Math.floor(g.t * 2) % 2 === 0 ? "_" : "";
    ctx.fillText(shown + caret, w / 2 + sx, h / 2 + sy);
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
});
