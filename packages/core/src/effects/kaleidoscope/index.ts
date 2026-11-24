import { defineEffect } from "../../plugins.ts";

/** Mirrors the layer into wedges around its centre, like a kaleidoscope; turns on the beat. */
export default defineEffect({
  id: "kaleidoscope",
  label: "Kaleidoscope",
  description: "Mirrors the layer into wedges around its centre, like a kaleidoscope, turning in time with the beat.",
  params: [
    { name: "segments", label: "Segments", type: "int", min: 2, max: 16, default: 6, description: "How many mirrored wedges make the circle." },
    { name: "angle", label: "Angle (degrees)", min: -180, max: 180, default: 0, description: "Turns the pattern: which part of the layer the wedges show." },
    { name: "spin", label: "Spin (turns/bar)", min: -2, max: 2, default: 0, description: "How fast it turns, in turns per 4 beats (0 stands still). Change it with a hold step: a gradual change makes it jump." },
    { name: "zoom", label: "Zoom", min: 0.25, max: 4, default: 1, description: "Above 1, the wedges show a smaller, closer part of the layer." },
  ],
  passes: [
    /* glsl */ `
    float aspect = u_res.x / u_res.y;
    vec2 p = uv - 0.5; p.x *= aspect;
    float r = length(p) / max(u_zoom, 0.01);
    float k = 6.2831853 / max(floor(u_segments + 0.5), 1.0);
    float a = atan(p.y, p.x) + radians(u_angle) + u_beat * 6.2831853 * u_spin / 4.0;
    a = mod(a, k); a = abs(a - k * 0.5);                       // fold into one wedge, mirrored
    vec2 q = vec2(cos(a), sin(a)) * r; q.x /= aspect;
    return texture(u_in, q + 0.5);`,
  ],
});
