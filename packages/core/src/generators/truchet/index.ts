import { defineGenerator } from "../../plugins.ts";

/** A maze of curved tiles (Truchet tiles); on the beat some tiles turn, rewiring the paths, and light up. */
export default defineGenerator({
  id: "truchet",
  label: "Truchet maze",
  description: "A maze of curved tiles that rewires itself on the beat (GPU): some tiles turn every few beats and light up as they do.",
  kind: "shader",
  colors: [
    { name: "line", label: "Paths", default: "ink" },
    { name: "highlight", label: "Highlight (just turned)", default: "accent" },
  ],
  params: [
    { name: "tiles", label: "Tiles", min: 2, max: 60, default: 12, description: "How many tiles fit across the layer's shorter side." },
    { name: "beatsPerChange", label: "Beats per change", min: 0.25, max: 16, default: 1, description: "How often tiles turn: every this many beats." },
    { name: "change", label: "Tiles changing", min: 0, max: 1, default: 0.15, description: "The share of tiles that turn at each change." },
    { name: "width", label: "Line width", min: 0.02, max: 0.5, default: 0.12, description: "Thickness of the paths, as a share of a tile." },
    { name: "glow", label: "Turn glow (beats)", min: 0, max: 8, default: 1.5, description: "How long a tile stays lit after it turns, in beats. 0: no highlight." },
    { name: "brightness", label: "Brightness", min: 0, max: 3, default: 1, description: "Overall brightness. Quiet passages are dim; loudness and hits brighten." },
    { name: "flash", label: "Hit flash", min: 0, max: 3, default: 0.6, description: "How much hits brighten the whole maze. 0 ignores hits." },
  ],
  fragment: /* glsl */ `
    vec2 p = vec2((uv.x - 0.5) * u_aspect, uv.y - 0.5) * u_tiles / min(u_aspect, 1.0);
    vec2 cell = floor(p);
    vec2 f = fract(p) - 0.5;
    float every = max(u_beatsPerChange, 0.01);
    float epoch = floor(u_beat / every);
    // a tile's way round is set when it last turned: look back over recent changes for the latest that hit it
    float last = -1e4;
    for (int k = 0; k < 24; k++) {
      float e = epoch - float(k);
      if (hash21(cell * 1.31 + vec2(e * 7.13, e * 3.71) + u_seed) < u_change) { last = e; break; }
    }
    float turned = step(0.5, hash21(cell + vec2(last * 1.7, -last * 2.3) + u_seed * 0.37));
    if (turned > 0.5) f.x = -f.x;
    // two quarter circles from opposite corners
    float d = min(abs(length(f - 0.5) - 0.5), abs(length(f + 0.5) - 0.5));
    float aa = fwidth(d);
    float w = u_width * 0.5;
    float line = (1.0 - smoothstep(w, w + aa, d)) * clamp(w * 2.0 / max(aa, 1e-4), 0.0, 1.0);
    float since = (u_beat - last * every) ;                     // beats since this tile turned
    float lit = u_glow > 0.0 ? clamp(1.0 - since / u_glow, 0.0, 1.0) : 0.0;
    float level = u_brightness * (0.25 + 0.75 * u_env) + u_flash * u_hit;
    float a = clamp(line * (level + lit), 0.0, 1.0);
    vec3 col = mix(u_line, u_highlight, lit);
    return vec4(col * a, a);
  `,
});
