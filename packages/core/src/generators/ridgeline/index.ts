import { line, area, curveBasis } from "d3-shape";
import { scaleLinear } from "d3-scale";
import { defineGenerator } from "../../plugins.ts";
import { mix, ink, acid, bg } from "../color.ts";

/**
 * Ridgeline ("Joy Division") of the stem's recent spectra: the newest at the front, older ones receding upward.
 * Each ridge is filled with the background colour so it hides the ones behind it.
 */
export default defineGenerator({
  id: "ridgeline",
  label: "Ridgeline",
  description: "Stacked spectrum lines over time, newest at the front, older ones receding into the distance.",
  kind: "canvas2d",
  params: [
    { name: "rows", label: "Rows", type: "int", min: 4, max: 80, default: 36 },
    { name: "spacing", label: "Frames between rows", type: "int", min: 1, max: 8, default: 2 },
    { name: "height", label: "Ridge height", min: 0, max: 2, default: 0.8 },
    { name: "floor", label: "Ignore below (level)", min: 0, max: 0.9, default: 0.35 },
    { name: "depth", label: "Perspective", min: 0, max: 0.9, default: 0.55 },
    { name: "lineWidth", label: "Line width", min: 0.5, max: 6, default: 1.5 },
    { name: "fill", label: "Hide lines behind", type: "toggle", min: 0, max: 1, default: 1 },
    { name: "acid", label: "Acid colour", min: 0, max: 2, default: 0 },
  ],
  draw(g) {
    const { ctx, w, h } = g;
    const rows = Math.max(1, Math.round(g.p("rows")));
    const spacing = Math.max(1, Math.round(g.p("spacing")));
    const depth = Math.min(0.95, Math.max(0, g.p("depth")));
    const fill = g.p("fill") >= 0.5;
    const rowGap = (h * 0.75) / rows;
    const amp = g.p("height") * rowGap * 12;
    const floor = Math.min(0.95, Math.max(0, g.p("floor")));
    const lw = g.p("lineWidth") * (Math.min(w, h) / 1080);
    for (let r = rows - 1; r >= 0; r--) { // back (oldest) to front (newest)
      const ago = r * spacing;
      const spec = g.spectrum(ago);
      const u = r / Math.max(1, rows - 1);           // 0 front .. 1 back
      const scale = 1 - depth * u;                    // narrower in the distance
      const base = h * 0.95 - (h * 0.75) * (1 - Math.pow(1 - u, 1.4)); // rows bunch up toward the horizon
      const x = scaleLinear().domain([0, spec.length - 1]).range([w / 2 - (w * 0.48) * scale, w / 2 + (w * 0.48) * scale]);
      // taper the ends so each ridge rises from a flat line
      const ys = spec.map((v, i) => {
        const e = Math.sin((Math.PI * i) / (spec.length - 1));
        const lift = Math.max(0, (v - floor) / (1 - floor)); // only what rises above the noise floor makes a peak
        return base - amp * scale * Math.pow(lift, 1.5) * e * e;
      });
      const pts = ys.map((y, i) => [x(i), y] as [number, number]);
      const edge: [number, number][] = [[x(0) - w * 0.02 * scale, base], ...pts, [x(spec.length - 1) + w * 0.02 * scale, base]];
      if (fill) {
        ctx.beginPath();
        area<[number, number]>().x((d) => d[0]).y0(base + 2).y1((d) => d[1]).curve(curveBasis).context(ctx)(edge);
        ctx.fillStyle = bg(g.palette);
        ctx.fill();
      }
      ctx.beginPath();
      line<[number, number]>().x((d) => d[0]).y((d) => d[1]).curve(curveBasis).context(ctx)(edge);
      const fade = 0.15 + 0.85 * Math.pow(1 - u, 1.5);
      ctx.strokeStyle = mix(ink(g.palette), acid(g.palette), g.p("acid") * g.f("centroid", ago), fade);
      ctx.lineWidth = lw * (r === 0 ? 1.6 : 1);
      ctx.stroke();
    }
  },
});
