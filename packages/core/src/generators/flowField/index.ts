import { defineGenerator } from "../../plugins.ts";

/** Contour lines of a drifting, domain-warped noise field; drum hits kick the warp and flash the lines. */
export default defineGenerator({
  id: "flowField",
  label: "Flow field",
  description: "Flowing contour lines of animated noise (GPU). Hits distort and brighten the flow; hats thicken lines.",
  kind: "shader",
  colors: [
    { name: "line", label: "Lines", default: "ink" },
    { name: "highlight", label: "Highlight", default: "accent" },
  ],
  params: [
    { name: "scale", label: "Scale", min: 0.5, max: 8, default: 2.5, description: "Zoom of the pattern: larger values give more, smaller swirls." },
    { name: "speed", label: "Drift speed", min: 0, max: 2, default: 0.2, description: "How fast the field drifts and evolves." },
    { name: "density", label: "Lines", min: 2, max: 40, default: 14, description: "How many contour lines: more lines, closer together." },
    { name: "warp", label: "Warp", min: 0, max: 3, default: 1.2, description: "How much the field is folded over itself: 0 is gentle hills, higher is marbled." },
    { name: "thickness", label: "Line thickness", min: 0.01, max: 0.5, default: 0.08, description: "Thickness of the lines (hats add to it)." },
    { name: "brightness", label: "Brightness", min: 0, max: 3, default: 1, description: "Overall brightness. Quiet passages are dim; loudness and hits brighten." },
    { name: "kick", label: "Hit response", min: 0, max: 3, default: 1, description: "How strongly hits distort the flow and flash the lines. 0 ignores hits." },
    { name: "acid", label: "Highlight amount", min: 0, max: 1, default: 0.3, description: "How much the lines take the highlight colour, more when the sound is brighter." },
  ],
  fragment: /* glsl */ `
    vec2 p = vec2((uv.x - 0.5) * u_aspect, uv.y - 0.5) * u_scale;
    float t = u_time * u_speed;
    vec2 q = vec2(fbm(p * 0.7 + vec2(t * 0.6, 3.1)), fbm(p * 0.7 + vec2(7.7, -t * 0.5)));
    float n = fbm(p + vec2(0.0, t) + u_warp * (1.0 + u_kick * 1.5 * u_hit) * q);
    float d = abs(fract(n * u_density) - 0.5);
    float w = u_thickness * (0.6 + 0.8 * u_high);
    // Lines look the same at any size: at a small size a thin line fades instead of breaking up.
    // Only where a line is thinner than about a pixel (the soft edge narrower than the pattern changes across a
    // pixel) is it widened to a pixel and dimmed to match; elsewhere it's exactly as before.
    float aa = fwidth(n * u_density);
    float line = (1.0 - smoothstep(w * 0.5, max(w, w * 0.5 + aa), d)) * clamp(w / max(aa, 1e-4), 0.0, 1.0);
    float a = line * clamp((0.12 + 0.9 * u_env + 0.9 * u_kick * u_hit) * u_brightness, 0.0, 1.0);
    vec3 col = mix(u_line, u_highlight, clamp(u_acid * (0.5 + u_centroid), 0.0, 1.0));
    return vec4(col * a, a);
  `,
});
