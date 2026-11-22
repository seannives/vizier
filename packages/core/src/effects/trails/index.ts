import { defineEffect } from "../../plugins.ts";

/**
 * Feedback trails: each frame is drawn over a faded, slightly zoomed and rotated copy of the previous output.
 * Persistence is in seconds, so trails look the same at 30 fps (video) and 60 fps (live).
 */
export default defineEffect({
  id: "trails",
  label: "Trails",
  description: "Leaves fading copies of the layer behind it; zoom and rotation turn them into tunnels and spirals.",
  feedback: true,
  params: [
    { name: "persistence", label: "Persistence (s to fade)", min: 0.05, max: 3, default: 0.6 },
    { name: "zoom", label: "Zoom per second", min: 0.5, max: 2, default: 1.0 },
    { name: "rotate", label: "Rotate (degrees/s)", min: -90, max: 90, default: 0 },
  ],
  passes: [
    /* glsl */ `
    float decay = pow(0.1, 1.0 / max(0.001, u_persistence * u_fps));
    float z = pow(u_zoom, 1.0 / u_fps);
    float r = radians(u_rotate) / u_fps;
    vec2 c = uv - 0.5;
    c.x *= u_res.x / u_res.y;
    c = mat2(cos(r), -sin(r), sin(r), cos(r)) * c / z;
    c.x /= u_res.x / u_res.y;
    vec2 puv = c + 0.5;
    // The feedback buffer holds 8 bits a channel: a faint value times the decay rounds back to itself (at
    // persistence 1.6 s anything up to 10/255 never fades), leaving a haze over the whole layer. Taking one
    // more step off each frame makes every value reach zero.
    vec4 prev = (puv.x < 0.0 || puv.y < 0.0 || puv.x > 1.0 || puv.y > 1.0) ? vec4(0.0) : max(texture(u_fb, puv) * decay - 1.0 / 255.0, 0.0);
    vec4 s = texture(u_in, uv);
    return s + prev * (1.0 - s.a);`,
  ],
});
