import type { FeatureTrack } from "@vizier/features";
import { getProfile, type OutputProfile } from "../profiles.ts";
import { layoutFor, type BlendMode, type LayerDef, type Project } from "../project.ts";
import { ParamResolver } from "../resolve.ts";
import { frameRng } from "../rng.ts";
import { GENERATORS, type DrawContext } from "./generators.ts";

const VS = `#version 300 es
in vec2 a; out vec2 uv;
uniform vec2 centre, halfSize; uniform float rot, aspect;
void main(){
  uv = vec2(a.x*0.5+0.5, 0.5-a.y*0.5);
  vec2 p = a*halfSize; p.x *= aspect;
  p = vec2(p.x*cos(rot)-p.y*sin(rot), p.x*sin(rot)+p.y*cos(rot));
  p.x /= aspect;
  gl_Position = vec4(centre + p, 0., 1.);
}`;
const FS_LAYER = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D tex; uniform float opacity;
void main(){ o = texture(tex, uv) * opacity; }`;
const FS_POST = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D tex; uniform vec3 bg; uniform float grain, vignette, seed; uniform vec2 res;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + seed) * 43758.5453); }
void main(){
  vec4 c = texture(tex, vec2(uv.x, 1.0-uv.y));
  vec3 col = bg*(1.0-c.a) + c.rgb;
  float d = distance(uv, vec2(.5));
  col *= 1.0 - vignette * smoothstep(.35, .85, d);
  col += (h(floor(uv*res)) - .5) * grain;
  o = vec4(col, 1.);
}`;

interface LayerState { def: LayerDef; canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D; tex: WebGLTexture }

/** Renders any frame of a project from (frame number, features). Same code drives offline and live. */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly profile: OutputProfile;
  private gl: WebGL2RenderingContext;
  private layers: LayerState[] = [];
  private resolver: ParamResolver;
  private progLayer: WebGLProgram;
  private progPost: WebGLProgram;
  private fbo: WebGLFramebuffer;
  private fboTex: WebGLTexture;
  private pixels: Uint8Array;
  /** When set, renderFrame adds each layer's draw+upload time (ms) here. */
  timing: Record<string, number> | null = null;

  constructor(private project: Project, profileId: string, private tracks: Record<string, FeatureTrack>, private font = "'Special Elite'") {
    this.profile = getProfile(profileId);
    const { width, height } = this.profile;
    this.canvas = document.createElement("canvas");
    this.canvas.width = width; this.canvas.height = height;
    const gl = this.canvas.getContext("webgl2", { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error("WebGL2 not available");
    this.gl = gl;
    this.resolver = new ParamResolver(project);
    this.progLayer = this.program(VS, FS_LAYER);
    this.progPost = this.program(VS, FS_POST);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.fboTex = this.texture(width, height);
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.pixels = new Uint8Array(width * height * 4);
    for (const def of [...project.layers].sort((a, b) => a.z - b.z)) {
      if (!GENERATORS[def.generator]) throw new Error(`Unknown generator ${def.generator}`);
      const tr = layoutFor(def, this.profile.layout);
      const s = def.resolutionScale ?? 1;
      const cw = Math.max(1, Math.round(tr.w * width * s)), ch = Math.max(1, Math.round(tr.h * height * s));
      const canvas = new OffscreenCanvas(cw, ch);
      this.layers.push({ def, canvas, ctx: canvas.getContext("2d")!, tex: this.texture(cw, ch) });
    }
  }

  private program(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const p = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, "a");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link error");
    return p;
  }

  private texture(w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private setBlend(mode: BlendMode) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    if (mode === "add") gl.blendFunc(gl.ONE, gl.ONE);
    else if (mode === "screen") gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    else if (mode === "multiply") gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Feature lookup by stem at a given output frame, k frames in the past (causal: never looks ahead). */
  private feature(stem: string, name: string, frame: number): number {
    const tr = this.tracks[stem];
    if (!tr || frame < 0) return 0;
    const i = Math.min(tr.frameCount - 1, Math.round((frame * tr.fps) / this.profile.fps));
    return (tr.scalars as Record<string, number[]>)[name]?.[i] ?? 0;
  }
  private spectrum(stem: string, frame: number): number[] {
    const tr = this.tracks[stem];
    if (!tr) return new Array(32).fill(0);
    const i = Math.max(0, Math.min(tr.frameCount - 1, Math.round((frame * tr.fps) / this.profile.fps)));
    return frame < 0 ? new Array(tr.bins).fill(0) : tr.spectrum.slice(i * tr.bins, (i + 1) * tr.bins);
  }

  renderFrame(frame: number): void {
    const gl = this.gl;
    const { width, height, fps } = this.profile;
    const t = frame / fps;
    const lookup = (stem: string, feat: string) => this.feature(stem, feat, frame);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.progLayer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    const u = (n: string) => gl.getUniformLocation(this.progLayer, n);
    this.layers.forEach((L, idx) => {
      const id = L.def.id;
      const base = layoutFor(L.def, this.profile.layout);
      const pv = (name: string, fallback: number) => this.resolver.value(`${id}.${name}`, L.def.params?.[name] ?? fallback, t, lookup);
      const opacity = pv("opacity", L.def.opacity ?? 1);
      if (opacity <= 0.001) return;
      const stem = L.def.stem ?? "main";
      const ctx = L.ctx as unknown as CanvasRenderingContext2D;
      ctx.clearRect(0, 0, L.canvas.width, L.canvas.height);
      const g: DrawContext = {
        ctx, w: L.canvas.width, h: L.canvas.height, t, frame, fps,
        p: pv,
        f: (name, ago = 0, s = stem) => this.feature(s, name, frame - ago),
        spectrum: (ago = 0, s = stem) => this.spectrum(s, frame - ago),
        rng: frameRng(this.project.seed, frame, idx + 1),
        palette: this.project.palette,
        text: L.def.text ?? "",
        font: this.font,
      };
      const t0 = this.timing ? performance.now() : 0;
      GENERATORS[L.def.generator]!.draw(g);
      gl.bindTexture(gl.TEXTURE_2D, L.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, L.canvas);
      if (this.timing) this.timing[id] = (this.timing[id] ?? 0) + performance.now() - t0;
      const x = pv("x", base.x), y = pv("y", base.y), w = pv("w", base.w), h = pv("h", base.h);
      gl.uniform2f(u("centre"), x * 2 - 1, 1 - y * 2);
      gl.uniform2f(u("halfSize"), w, h);
      gl.uniform1f(u("rot"), (pv("rotation", base.rotation ?? 0) * Math.PI) / 180);
      gl.uniform1f(u("aspect"), width / height);
      gl.uniform1f(u("opacity"), Math.min(1, opacity));
      this.setBlend(L.def.blend ?? "normal");
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });
    // post: background colour, vignette, film grain (seeded per frame)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.BLEND);
    gl.useProgram(this.progPost);
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    const up = (n: string) => gl.getUniformLocation(this.progPost, n);
    const bg = (this.project.palette.bg ?? "#2B2420").replace("#", "");
    const n = parseInt(bg, 16);
    gl.uniform3f(up("bg"), ((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
    gl.uniform1f(up("grain"), this.resolver.value("post.grain", 0.05, t, lookup));
    gl.uniform1f(up("vignette"), this.resolver.value("post.vignette", 0.55, t, lookup));
    gl.uniform1f(up("seed"), (frame % 997) * 0.731);
    gl.uniform2f(up("res"), width, height);
    gl.uniform2f(up("centre"), 0, 0);
    gl.uniform2f(up("halfSize"), 1, 1);
    gl.uniform1f(up("rot"), 0);
    gl.uniform1f(up("aspect"), 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Render-only benchmark: what live playback costs, without reading pixels back or encoding video.
   * Waits for the GPU each frame (gl.finish) so the numbers are honest.
   */
  bench(start: number, count: number): { avgMs: number; p95Ms: number; maxMs: number; layersMs: Record<string, number> } {
    const gl = this.gl;
    for (let f = start; f < start + 10; f++) this.renderFrame(f); // warm up shaders, caches and JIT
    gl.finish();
    this.timing = {};
    const times: number[] = [];
    for (let f = start; f < start + count; f++) {
      const t0 = performance.now();
      this.renderFrame(f);
      gl.finish();
      times.push(performance.now() - t0);
    }
    const layersMs = Object.fromEntries(Object.entries(this.timing).map(([k, v]) => [k, v / count]));
    this.timing = null;
    times.sort((a, b) => a - b);
    return { avgMs: times.reduce((a, b) => a + b, 0) / count, p95Ms: times[Math.floor(count * 0.95)]!, maxMs: times[count - 1]!, layersMs };
  }

  /** RGBA pixels of the last frame, bottom row first (as WebGL returns them). */
  readPixels(): Uint8Array {
    const gl = this.gl;
    gl.readPixels(0, 0, this.profile.width, this.profile.height, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
    return this.pixels;
  }
}
