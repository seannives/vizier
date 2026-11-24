import { defineEffect } from "../../plugins.ts";

/** Chromatic aberration and glitch: red and blue pulled apart sideways, more on hits; strips of the picture jump. */
export default defineEffect({
  id: "rgbSplit",
  label: "RGB split",
  description: "Pulls the red and blue apart sideways, wider on hits, and on hits makes strips of the picture jump (a glitch).",
  params: [
    { name: "offset", label: "Split (pixels)", min: 0, max: 40, default: 4, pixels: true, description: "How far red and blue sit from green, in pixels of the full-size video, all the time." },
    { name: "kick", label: "Hit split (pixels)", min: 0, max: 80, default: 16, pixels: true, description: "How much further they move apart on a hit (fading with it)." },
    { name: "glitch", label: "Glitch", min: 0, max: 1, default: 0.3, description: "On hits, how many horizontal strips jump sideways. 0: none." },
    { name: "strips", label: "Strips", type: "int", min: 2, max: 64, default: 18, description: "How many strips the picture is cut into for the glitch." },
  ],
  passes: [
    /* glsl */ `
    vec2 q = uv;
    // the glitch: on hits, some strips jump sideways (the same jump for a few frames, then a new one)
    float strip = floor(uv.y * u_strips);
    float when = floor(u_time * u_fps / 3.0);
    if (hash21(vec2(strip, when) + 0.37) < u_glitch * u_hit) q.x += (hash21(vec2(when, strip) + 4.1) - 0.5) * 0.12 * u_hit;
    float off = (u_offset + u_kick * u_hit) * u_texel.x;
    vec4 c = texture(u_in, q);
    vec4 r = texture(u_in, q + vec2(off, 0.0)), b = texture(u_in, q - vec2(off, 0.0));
    return vec4(r.r, c.g, b.b, max(c.a, max(r.a, b.a)));`,
  ],
});
