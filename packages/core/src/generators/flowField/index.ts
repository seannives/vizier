import { defineGenerator } from "../../plugins.ts";

/** Contour lines of a drifting, domain-warped noise field; drum hits kick the warp and flash the lines. */
export default defineGenerator({
  id: "flowField",
  label: "Flow field",
  description: "Flowing contour lines of animated noise (GPU). Hits distort and brighten the flow; hats thicken lines.",
  kind: "shader",
  params: [
    { name: "scale", label: "Scale", min: 0.5, max: 8, default: 2.5 },
    { name: "speed", label: "Drift speed", min: 0, max: 2, default: 0.2 },
    { name: "density", label: "Lines", min: 2, max: 40, default: 14 },
    { name: "warp", label: "Warp", min: 0, max: 3, default: 1.2 },
    { name: "thickness", label: "Line thickness", min: 0.01, max: 0.5, default: 0.08 },
    { name: "brightness", label: "Brightness", min: 0, max: 3, default: 1 },
    { name: "kick", label: "Hit response", min: 0, max: 3, default: 1 },
    { name: "acid", label: "Acid colour", min: 0, max: 1, default: 0.3 },
  ],
  fragment: /* glsl */ `
    vec2 p = vec2((uv.x - 0.5) * u_aspect, uv.y - 0.5) * u_scale;
    float t = u_time * u_speed;
    vec2 q = vec2(fbm(p * 0.7 + vec2(t * 0.6, 3.1)), fbm(p * 0.7 + vec2(7.7, -t * 0.5)));
    float n = fbm(p + vec2(0.0, t) + u_warp * (1.0 + u_kick * 1.5 * u_hit) * q);
    float d = abs(fract(n * u_density) - 0.5);
    float w = u_thickness * (0.6 + 0.8 * u_high);
    float line = 1.0 - smoothstep(w * 0.5, w, d);
    float a = line * clamp((0.12 + 0.9 * u_env + 0.9 * u_kick * u_hit) * u_brightness, 0.0, 1.0);
    vec3 col = mix(u_inkColor, u_acidColor, clamp(u_acid * (0.5 + u_centroid), 0.0, 1.0));
    return vec4(col * a, a);
  `,
});
