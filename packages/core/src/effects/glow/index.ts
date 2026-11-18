import { defineEffect } from "../../plugins.ts";

/** Soft bloom: a two-pass Gaussian blur of the layer, added back on top of it. */
export default defineEffect({
  id: "glow",
  label: "Glow",
  description: "Adds a soft blurred halo around bright parts of the layer.",
  params: [
    { name: "amount", label: "Amount", min: 0, max: 3, default: 1 },
    { name: "radius", label: "Radius (pixels)", min: 1, max: 40, default: 8, pixels: true },
  ],
  passes: [
    /* glsl */ `
    vec4 s = vec4(0.0); float wsum = 0.0;
    for (int i = -6; i <= 6; i++) { float w = exp(-float(i * i) / 18.0); s += texture(u_in, uv + vec2(float(i) * u_radius / 6.0 * u_texel.x, 0.0)) * w; wsum += w; }
    return s / wsum;`,
    /* glsl */ `
    vec4 s = vec4(0.0); float wsum = 0.0;
    for (int i = -6; i <= 6; i++) { float w = exp(-float(i * i) / 18.0); s += texture(u_in, uv + vec2(0.0, float(i) * u_radius / 6.0 * u_texel.y)) * w; wsum += w; }
    vec4 o = texture(u_orig, uv);
    return clamp(o + (s / wsum) * u_amount, 0.0, 1.0);`,
  ],
});
