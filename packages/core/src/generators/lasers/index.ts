import { defineGenerator } from "../../plugins.ts";

/** A fan of laser beams from one point, sweeping in time with the beat; loudness lights them, hits strobe them. */
export default defineGenerator({
  id: "lasers",
  label: "Laser fan",
  description: "A fan of laser beams from a point, sweeping on the beat (GPU). Loudness lights the beams; hits strobe them.",
  kind: "shader",
  colors: [
    { name: "beam", label: "Beams", default: "accent" },
    { name: "core", label: "Core (hot centre)", default: "ink" },
  ],
  params: [
    { name: "beams", label: "Beams", type: "int", min: 1, max: 32, default: 9, description: "How many beams in the fan." },
    { name: "spread", label: "Spread (degrees)", min: 0, max: 180, default: 100, description: "The angle the fan covers, from the first beam to the last." },
    { name: "sweep", label: "Sweep (degrees)", min: 0, max: 90, default: 25, description: "How far the whole fan swings either way, in time with the beat." },
    { name: "beatsPerSweep", label: "Beats per sweep", min: 1, max: 32, default: 4, description: "How many beats one swing (one way) takes: 4 is a bar in 4/4. Change it with a hold step: a gradual change makes the fan jump." },
    { name: "scissor", label: "Scissor", type: "toggle", min: 0, max: 1, default: 0, description: "Every other beam swings the opposite way, so the beams cross like scissors." },
    { name: "origin", label: "Origin height", min: -0.5, max: 1.5, default: 0, description: "Where the beams start: 0 the bottom of the layer, 1 the top (and beyond, off the edge)." },
    { name: "width", label: "Beam width", min: 0.001, max: 0.03, default: 0.004, description: "Thickness of a beam, as a share of the layer's height." },
    { name: "haze", label: "Haze", min: 0, max: 2, default: 0.6, description: "A soft glow around each beam, as if through smoke." },
    { name: "falloff", label: "Falloff", min: 0, max: 4, default: 0.8, description: "How quickly beams fade with distance from where they start." },
    { name: "brightness", label: "Brightness", min: 0, max: 3, default: 1, description: "Overall brightness. Quiet passages are dim; loudness lights the beams." },
    { name: "strobe", label: "Hit strobe", min: 0, max: 3, default: 1, description: "How much hits flash the beams. 0 ignores hits." },
  ],
  fragment: /* glsl */ `
    vec2 p = vec2((uv.x - 0.5) * u_aspect, uv.y - u_origin);
    float r = length(p);
    float ang = atan(p.x, p.y);                                   // 0 straight up, positive to the right
    float sw = radians(u_sweep) * sin(u_beat * 3.14159265 / max(u_beatsPerSweep, 0.001));
    float n = max(1.0, floor(u_beams + 0.5));
    float beam = 0.0, haze = 0.0;
    for (int i = 0; i < 32; i++) {
      if (float(i) >= n) break;
      float k = n > 1.0 ? float(i) / (n - 1.0) - 0.5 : 0.0;
      float dir = (u_scissor > 0.5 && mod(float(i), 2.0) > 0.5) ? -1.0 : 1.0;
      float a = k * radians(u_spread) + sw * dir;
      // distance from the beam's line (only in front of the origin)
      float along = r * cos(ang - a);
      float d = along > 0.0 ? abs(r * sin(ang - a)) : 1e3;
      float aa = fwidth(d);
      float w = u_width;
      beam += (1.0 - smoothstep(w * 0.5, max(w, w * 0.5 + aa), d)) * clamp(w / max(aa, 1e-4), 0.0, 1.0);
      haze += exp(-d / (w * 6.0 + 0.004)) * 0.35;
    }
    float fade = exp(-r * u_falloff);
    float level = u_brightness * (0.15 + 0.85 * u_env) + u_strobe * u_hit;
    float a = clamp((beam + haze * u_haze) * fade * level, 0.0, 1.0);
    vec3 col = mix(u_beam, u_core, clamp(beam * fade * 0.6, 0.0, 1.0));
    return vec4(col * a, a);
  `,
});
