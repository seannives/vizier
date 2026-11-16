import { defineGenerator } from "../../plugins.ts";
import { rgba } from "../color.ts";

/** A field of dots that breathes with the stem's low end and lights up on onsets. */
export default defineGenerator({
  id: "pulseGrid",
  label: "Pulse grid",
  description: "A halftone dot field that breathes with the low end, ripples from the centre and flashes on onsets.",
  kind: "canvas2d",
  colors: [{ name: "dots", label: "Dots", default: "ink" }],
  params: [
    { name: "density", label: "Density (dots across)", min: 4, max: 60, default: 18 },
    { name: "brightness", label: "Brightness", min: 0, max: 2, default: 1 },
    { name: "wave", label: "Ripple speed", min: 0, max: 4, default: 1 },
  ],
  draw(g) {
    const { ctx, w, h } = g;
    const step = Math.max(8, Math.min(w, h) / g.p("density"));
    const low = g.f("low"), env = g.f("env");
    let flash = 0;
    for (let k = 0; k < 6; k++) if (g.f("onset", k) > 0) { flash = 1 - k / 6; break; }
    const cx = w / 2, cy = h / 2, maxD = Math.hypot(cx, cy);
    const wave = g.p("wave");
    ctx.fillStyle = rgba(g.color("dots"));
    for (let y = step / 2; y < h; y += step) {
      for (let x = step / 2; x < w; x += step) {
        const d = Math.hypot(x - cx, y - cy) / maxD;
        const ripple = 0.5 + 0.5 * Math.sin(d * 14 - g.t * 3 * wave);
        const r = step * 0.08 * (0.4 + 1.6 * low * ripple) * (1 + flash * (1 - d));
        ctx.globalAlpha = Math.min(1, (0.08 + 0.35 * env * ripple + 0.3 * flash * (1 - d)) * g.p("brightness"));
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  },
});
