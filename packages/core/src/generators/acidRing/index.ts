import { lineRadial, curveCardinalClosed } from "d3-shape";
import { scaleLinear } from "d3-scale";
import { defineGenerator } from "../../plugins.ts";
import { mix } from "../color.ts";

/** A ring traced by the stem's spectrum, with echoes of recent frames. Built for a 303: colour follows the filter. */
export default defineGenerator({
  id: "acidRing",
  label: "Acid ring",
  description: "A closed curve traced by the spectrum, with fading echoes of recent frames; colour follows the filter (centroid).",
  kind: "canvas2d",
  colors: [
    { name: "line", label: "Line", default: "ink" },
    { name: "highlight", label: "Highlight (open filter)", default: "accent" },
  ],
  params: [
    { name: "radius", label: "Radius", min: 0.2, max: 2, default: 1 },
    { name: "spike", label: "Spectrum spikes", min: 0, max: 1, default: 0.3 },
    { name: "spin", label: "Spin (turns/s)", min: -1, max: 1, default: 0.05 },
    { name: "acid", label: "Highlight amount", min: 0, max: 2, default: 1 },
    { name: "echoes", label: "Echoes", type: "int", min: 0, max: 30, default: 10 },
    { name: "echoSpacing", label: "Echo spacing (frames)", type: "int", min: 1, max: 10, default: 2 },
    { name: "lineWidth", label: "Line width", min: 0.5, max: 10, default: 2 },
  ],
  draw(g) {
    const { ctx, w, h } = g;
    const m = Math.min(w, h);
    const echoes = Math.round(g.p("echoes"));
    const spacing = Math.max(1, Math.round(g.p("echoSpacing")));
    const baseR = 0.22 * m * g.p("radius");
    const spike = g.p("spike") * m;
    const spin = g.p("spin");
    const acidAmt = g.p("acid");
    const lineW = g.p("lineWidth") * (m / 1080);
    const line = g.color("line"), hi = g.color("highlight");
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
      const curve = lineRadial<number>()
        .angle((_, i) => ang(i) + rot)
        .radius((v) => baseR * (1 + 0.35 * env) * (1 + k * 0.035) + spike * Math.pow(v, 2.2))
        .curve(curveCardinalClosed.tension(0.3))
        .context(ctx);
      const fade = Math.pow(1 - k / (echoes + 1), 2);
      ctx.beginPath();
      curve(pts);
      ctx.strokeStyle = mix(line, hi, cen * 1.6 * acidAmt, 0.85 * fade);
      ctx.lineWidth = lineW * (k === 0 ? 1.8 : 1);
      ctx.stroke();
    }
    for (let k = 0; k < 8; k++) {
      if (g.f("onset", k) > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, baseR * (0.6 + k * 0.12), 0, 2 * Math.PI);
        ctx.strokeStyle = mix(line, hi, acidAmt, 0.5 * (1 - k / 8));
        ctx.lineWidth = lineW * 0.75;
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  },
});
