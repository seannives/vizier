import { defineGenerator } from "../../plugins.ts";

/** An endless tunnel of rings rushing towards you, a ring per beat; the low end pumps it, hits flash it. */
export default defineGenerator({
  id: "tunnel",
  label: "Tunnel",
  description: "Rings (round or with corners) rushing towards you in time with the beat (GPU). The low end pumps them; hits flash them.",
  kind: "shader",
  colors: [
    { name: "line", label: "Rings", default: "ink" },
    { name: "highlight", label: "Highlight (hits)", default: "accent" },
  ],
  params: [
    { name: "sides", label: "Sides", type: "int", min: 0, max: 8, default: 4, description: "The rings' shape: 0 round, 3 triangles, 4 squares, 6 hexagons…" },
    { name: "ringsPerBeat", label: "Rings per beat", min: 0, max: 4, default: 1, description: "Rings passing you per beat (0 stands still). Change it at a bar with a hold step: a gradual change makes the tunnel jump." },
    { name: "density", label: "Depth spacing", min: 0.5, max: 8, default: 2.5, description: "How close together the rings are: more rings fit in the view." },
    { name: "twist", label: "Twist", min: -3, max: 3, default: 0.4, description: "How much the rings turn with depth, making a spiral." },
    { name: "spin", label: "Spin (turns/bar)", min: -2, max: 2, default: 0.05, description: "How fast the tunnel turns, in turns per 4 beats. Change it with a hold step: a gradual change makes it jump." },
    { name: "width", label: "Line width", min: 0.01, max: 0.5, default: 0.08, description: "Thickness of the rings, as a share of the space between them." },
    { name: "pump", label: "Low-end pump", min: 0, max: 2, default: 0.6, description: "How much the kick and sub widen the rings. 0 ignores the low end." },
    { name: "brightness", label: "Brightness", min: 0, max: 3, default: 1, description: "Overall brightness. The far end fades into the dark." },
    { name: "flash", label: "Hit flash", min: 0, max: 3, default: 1, description: "How much hits light the rings in the highlight colour. 0 ignores hits." },
  ],
  fragment: /* glsl */ `
    vec2 p = vec2((uv.x - 0.5) * u_aspect, uv.y - 0.5);
    float r = length(p) + 1e-4;
    float ang = atan(p.y, p.x) - u_twist * log(r) + u_beat * 6.2831853 * u_spin / 4.0;
    float sides = floor(u_sides + 0.5);
    // distance to the centre measured along the shape: circles, or polygons with that many sides
    if (sides >= 3.0) { float k = 6.2831853 / sides; r *= cos(floor(0.5 + ang / k) * k - ang); }
    // rings equally spaced in depth (log of the distance), moving towards you on the beat
    float s = -log(r) * u_density + u_beat * u_ringsPerBeat;
    float d = abs(fract(s) - 0.5);                              // 0.5 at a ring, 0 between rings
    float w = clamp(u_width * (1.0 + u_pump * u_low), 0.0, 0.95) * 0.5;
    float aa = fwidth(s);
    float ring = smoothstep(0.5 - w - aa, 0.5 - w, d) * clamp(w * 2.0 / max(aa, 1e-4), 0.0, 1.0);
    float depth = clamp(r * 3.0, 0.0, 1.0);                     // the far end (the middle) fades to dark
    float level = u_brightness * (0.2 + 0.8 * u_env) + u_flash * u_hit;
    float a = clamp(ring * depth * level, 0.0, 1.0);
    vec3 col = mix(u_line, u_highlight, clamp(u_flash * u_hit, 0.0, 1.0));
    return vec4(col * a, a);
  `,
});
