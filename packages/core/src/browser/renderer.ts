import type { FeatureTrack } from "@vizier/features";
import { getProfile, type OutputProfile } from "../profiles.ts";
import { layoutFor, normalizePalette, type BlendMode, type LayerDef, type Project } from "../project.ts";
import { ParamResolver } from "../resolve.ts";
import { frameRng } from "../rng.ts";
import { GENERATORS } from "../generators/index.ts";
import { EFFECTS } from "../effects/index.ts";
import { defaults, PALETTE_SLOTS, PALETTE_ALIASES, type DrawContext, type EffectDef, type Generator, type ParamSpec } from "../plugins.ts";
import { parseHex, shiftColor } from "../color.ts";

// Composite: draws a layer texture as a transformed quad on the output.
const VS_QUAD = `#version 300 es
in vec2 a; out vec2 uv;
uniform vec2 centre, halfSize; uniform float rot, aspect;
void main(){
  uv = vec2(a.x*0.5+0.5, 0.5-a.y*0.5);
  vec2 p = a*halfSize; p.x *= aspect;
  p = vec2(p.x*cos(rot)-p.y*sin(rot), p.x*sin(rot)+p.y*cos(rot));
  p.x /= aspect;
  gl_Position = vec4(centre + p, 0., 1.);
}`;
// Full-target pass for shader generators and effects. uv is texture space (row 0 = top of the image).
const VS_FULL = `#version 300 es
in vec2 a; out vec2 uv;
void main(){ uv = a*0.5+0.5; gl_Position = vec4(a, 0., 1.); }`;
const FS_LAYER = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D tex; uniform float opacity;
void main(){ o = texture(tex, uv) * opacity; }`;
const FS_POST = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D tex; uniform vec3 bg; uniform float grain, vignette, seed; uniform vec2 res;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + seed) * 43758.5453); }
void main(){
  vec2 st = vec2(uv.x, 1.0 - uv.y);
  vec4 c = texture(tex, st);
  vec3 col = bg*(1.0-c.a) + c.rgb;
  float d = distance(uv, vec2(.5));
  col *= 1.0 - vignette * smoothstep(.35, .85, d);
  col += (h(floor(uv*res)) - .5) * grain;
  o = vec4(col, 1.);
}`;
const GLSL_LIB = `
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1,0)), u.x), mix(hash21(i+vec2(0,1)), hash21(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a*noise(p); p = p*2.02 + 17.1; a *= 0.5; } return s; }
`;
const FEATURE_UNIFORMS = ["rms", "env", "low", "lowMid", "mid", "high", "centroid", "flux", "onset", "hit"];
const uniformDecl = (specs: ParamSpec[]) => specs.map((s) => `uniform float u_${s.name};`).join("\n");

function generatorFS(g: Generator & { kind: "shader" }): string {
  return `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform vec2 u_res; uniform float u_aspect, u_time, u_frame, u_seed;
${FEATURE_UNIFORMS.map((f) => `uniform float u_${f};`).join(" ")}
uniform sampler2D u_specHist;
${PALETTE_SLOTS.map((s) => `uniform vec3 u_pal_${s.id};`).join(" ")}
${(g.colors ?? []).map((c) => `uniform vec3 u_${c.name};`).join(" ")}
${uniformDecl(g.params)}
${GLSL_LIB}
float spec(float bin, float ago){ return texture(u_specHist, vec2(bin, ago)).r; }
vec4 generate(vec2 uv){ ${g.fragment} }
void main(){ o = generate(vec2(uv.x, 1.0 - uv.y)); }`;
}

function effectFS(e: EffectDef, pass: string): string {
  return `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D u_in, u_orig, u_fb; uniform vec2 u_texel, u_res; uniform float u_time, u_fps;
${uniformDecl(e.params)}
${GLSL_LIB}
vec4 pass(vec2 uv){ ${pass} }
void main(){ o = pass(uv); }`;
}

interface Target { tex: WebGLTexture; fbo: WebGLFramebuffer }
interface EffectState { id: string; def: EffectDef; params: Record<string, number>; programs: WebGLProgram[]; fb: [Target, Target] | null }
interface LayerState {
  def: LayerDef; gen: Generator; w: number; h: number;
  canvas?: OffscreenCanvas; ctx?: OffscreenCanvasRenderingContext2D; srcTex?: WebGLTexture;
  program?: WebGLProgram; src?: Target;
  ping: [Target, Target]; effects: EffectState[];
}

/** Seconds of lead-in rendered before a jump, so feedback effects (trails) look the same as in a full render. */
export const PREROLL_SECONDS = 3;

export interface BenchStats {
  frames: number; avgMs: number; p95Ms: number; p99Ms: number; maxMs: number;
  over60: number; over30: number;               // frames slower than the 60 / 30 fps budget
  worst: { frame: number; ms: number }[];       // the five slowest frames, to see if a stall repeats
  layersMs: Record<string, number>;
}

export function benchStats(times: { f: number; ms: number }[], layersMs: Record<string, number>): BenchStats {
  const sorted = [...times].sort((a, b) => a.ms - b.ms);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!.ms;
  return {
    frames: times.length,
    avgMs: times.reduce((a, b) => a + b.ms, 0) / times.length,
    p95Ms: q(0.95), p99Ms: q(0.99), maxMs: sorted[sorted.length - 1]!.ms,
    over60: times.filter((t) => t.ms > 1000 / 60).length,
    over30: times.filter((t) => t.ms > 1000 / 30).length,
    worst: sorted.slice(-5).reverse().map((t) => ({ frame: t.f, ms: t.ms })),
    layersMs,
  };
}

/** Renders any frame of a project from (frame number, features). Same code drives offline and live. */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly profile: OutputProfile;
  private gl: WebGL2RenderingContext;
  private layers: LayerState[] = [];
  private resolver: ParamResolver;
  private progLayer: WebGLProgram;
  private progPost: WebGLProgram;
  private out: Target;
  private pixels: Uint8Array;
  private specTex: WebGLTexture;
  private specBuf = new Uint8Array(32 * 64);
  private hasFeedback: boolean;
  private lastFrame = Number.NaN;
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
    this.progLayer = this.program(VS_QUAD, FS_LAYER);
    this.progPost = this.program(VS_QUAD, FS_POST);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.out = this.target(width, height);
    this.pixels = new Uint8Array(width * height * 4);
    this.specTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.specTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 32, 64, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    this.texParams(gl.LINEAR);
    for (const def of [...project.layers].sort((a, b) => a.z - b.z)) {
      const gen = GENERATORS[def.generator];
      if (!gen) throw new Error(`Unknown generator ${def.generator}`);
      const tr = layoutFor(def, this.profile.layout);
      const s = def.resolutionScale ?? 1;
      const w = Math.max(1, Math.round(tr.w * width * s)), h = Math.max(1, Math.round(tr.h * height * s));
      const L: LayerState = { def, gen, w, h, ping: [this.target(w, h), this.target(w, h)], effects: [] };
      if (gen.kind === "canvas2d") {
        L.canvas = new OffscreenCanvas(w, h);
        L.ctx = L.canvas.getContext("2d")!;
        L.srcTex = this.texture(w, h);
      } else {
        L.program = this.program(VS_FULL, generatorFS(gen));
        L.src = this.target(w, h);
      }
      for (const ref of def.effects ?? []) {
        const e = EFFECTS[ref.type];
        if (!e) throw new Error(`Unknown effect ${ref.type}`);
        L.effects.push({
          id: ref.id ?? ref.type, def: e, params: { ...defaults(e.params), ...ref.params },
          programs: e.passes.map((p) => this.program(VS_FULL, effectFS(e, p))),
          fb: e.feedback ? [this.target(w, h), this.target(w, h)] : null,
        });
      }
      this.layers.push(L);
    }
    this.hasFeedback = this.layers.some((L) => L.effects.some((e) => e.fb));
  }

  private program(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const p = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error((gl.getShaderInfoLog(s) ?? "shader error") + "\n" + src);
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, "a");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link error");
    return p;
  }

  private texParams(filter: number) {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private texture(w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.texParams(gl.LINEAR);
    return t;
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = this.texture(w, h);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo };
  }

  private clear(t: Target, w: number, h: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private setBlend(mode: BlendMode) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    if (mode === "add") gl.blendFunc(gl.ONE, gl.ONE);
    else if (mode === "screen") gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    else if (mode === "multiply") gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private index(stem: string, frame: number): number {
    const tr = this.tracks[stem]!;
    return Math.min(tr.frameCount - 1, Math.round((frame * tr.fps) / this.profile.fps));
  }
  /** Feature lookup by stem at a given output frame (causal: never looks ahead). */
  private feature(stem: string, name: string, frame: number): number {
    const tr = this.tracks[stem];
    if (!tr || frame < 0) return 0;
    if (name === "hit") { // onset envelope decaying over ~0.3 s
      let v = 0;
      const span = Math.round(0.3 * this.profile.fps);
      for (let k = 0; k <= span; k++) if (this.feature(stem, "onset", frame - k) > 0) { v = Math.exp(-k / (span / 3)); break; }
      return v;
    }
    return (tr.scalars as Record<string, number[]>)[name]?.[this.index(stem, frame)] ?? 0;
  }
  private spectrum(stem: string, frame: number): number[] {
    const tr = this.tracks[stem];
    if (!tr || frame < 0) return new Array(tr?.bins ?? 32).fill(0);
    const i = this.index(stem, frame);
    return tr.spectrum.slice(i * tr.bins, (i + 1) * tr.bins);
  }
  /** The palette at time t: song/video palette, with palette lanes applied. */
  private paletteAt(t: number): Record<string, string> {
    const base = normalizePalette(this.project.palette);
    return Object.fromEntries(PALETTE_SLOTS.map((s) => [s.id, this.resolver.color(`palette.${s.id}`, base[s.id]!, t)]));
  }
  /** A layer's colour at time t: its lane, else its own colour or palette slot, then hue shift and lightness. */
  private layerColor(L: LayerState, name: string, palette: Record<string, string>, t: number, hue: number, light: number): string {
    const spec = L.gen.colors?.find((c) => c.name === name);
    const own = L.def.colors?.[name];
    const slot = own && !own.startsWith("#") ? PALETTE_ALIASES[own] ?? own : spec?.default ?? "ink";
    const base = own?.startsWith("#") ? own : palette[slot] ?? "#ffffff";
    return shiftColor(this.resolver.color(`${L.def.id}.${name}`, base, t), hue, light);
  }

  /** Render the moment `t` seconds into the song (live: driven by the audio clock, any display refresh rate). */
  renderAtTime(t: number): void { this.renderFrame(t * this.profile.fps); }

  /**
   * Render frame `frame` (may be fractional when driven by time). If the project has feedback effects and this
   * frame doesn't follow the last one, the feedback buffers are cleared and a few seconds of lead-in are rendered
   * first, so an excerpt looks like the same moment in a full render.
   */
  renderFrame(frame: number): void {
    if (this.hasFeedback && !(Math.abs(frame - this.lastFrame - 1) < 0.5 || (frame > this.lastFrame && frame - this.lastFrame <= 2))) {
      for (const L of this.layers) for (const e of L.effects) if (e.fb) for (const t of e.fb) this.clear(t, L.w, L.h);
      const pre = Math.round(PREROLL_SECONDS * this.profile.fps);
      for (let f = Math.max(0, frame - pre); f < frame; f++) this.drawLayers(f, false);
    }
    this.drawLayers(frame, true);
    this.lastFrame = frame;
  }

  private drawLayers(frame: number, output: boolean): void {
    const gl = this.gl;
    const { width, height, fps } = this.profile;
    const t = frame / fps;
    const lookup = (stem: string, feat: string) => this.feature(stem, feat, frame);
    const palette = this.paletteAt(t);
    const bg = parseHex(palette.bg!);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    const finals: (WebGLTexture | null)[] = [];
    this.layers.forEach((L, idx) => {
      const id = L.def.id;
      const genDefaults = defaults(L.gen.params);
      const pv = (name: string, fallback?: number) =>
        this.resolver.value(`${id}.${name}`, L.def.params?.[name] ?? genDefaults[name] ?? fallback ?? 0, t, lookup);
      const opacity = pv("opacity", L.def.opacity ?? 1);
      if (opacity <= 0.001 && !L.effects.some((e) => e.fb)) { finals.push(null); return; }
      const t0 = this.timing ? performance.now() : 0;
      const stem = L.def.track ?? this.project.mix;
      const hue = pv("hueShift"), light = pv("lightness");
      const colorCache = new Map<string, string>();
      const colorOf = (name: string) => {
        let c = colorCache.get(name);
        if (!c) { c = this.layerColor(L, name, palette, t, hue, light); colorCache.set(name, c); }
        return c;
      };
      // 1. the generator draws the layer's source image
      let src: WebGLTexture;
      if (L.gen.kind === "canvas2d") {
        const ctx = L.ctx as unknown as CanvasRenderingContext2D;
        ctx.clearRect(0, 0, L.w, L.h);
        const g: DrawContext = {
          ctx, w: L.w, h: L.h, t, frame, fps,
          p: (name) => pv(name),
          color: colorOf,
          f: (name, ago = 0, s = stem) => this.feature(s, name, frame - ago),
          spectrum: (ago = 0, s = stem) => this.spectrum(s, frame - ago),
          rng: frameRng(this.project.seed, Math.floor(frame), idx + 1),
          palette, text: L.def.text ?? "", font: this.font,
        };
        L.gen.draw(g);
        gl.bindTexture(gl.TEXTURE_2D, L.srcTex!);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, L.canvas!);
        src = L.srcTex!;
      } else {
        // spectrum history: 32 bins x 64 frames (row k = k frames ago)
        for (let k = 0; k < 64; k++) {
          const sp = this.spectrum(stem, frame - k);
          for (let b = 0; b < 32; b++) this.specBuf[k * 32 + b] = Math.round(255 * (sp[Math.floor((b * sp.length) / 32)] ?? 0));
        }
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.specTex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 32, 64, gl.RED, gl.UNSIGNED_BYTE, this.specBuf);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.activeTexture(gl.TEXTURE0);
        const p = L.program!;
        gl.useProgram(p);
        const u = (n: string) => gl.getUniformLocation(p, n);
        gl.uniform2f(u("u_res"), L.w, L.h);
        gl.uniform1f(u("u_aspect"), L.w / L.h);
        gl.uniform1f(u("u_time"), t);
        gl.uniform1f(u("u_frame"), frame);
        gl.uniform1f(u("u_seed"), this.project.seed);
        for (const f of FEATURE_UNIFORMS) gl.uniform1f(u(`u_${f}`), this.feature(stem, f, frame));
        gl.uniform1i(u("u_specHist"), 1);
        for (const s of PALETTE_SLOTS) gl.uniform3f(u(`u_pal_${s.id}`), ...parseHex(palette[s.id]!));
        for (const c of L.gen.colors ?? []) gl.uniform3f(u(`u_${c.name}`), ...parseHex(colorOf(c.name)));
        for (const s of L.gen.params) gl.uniform1f(u(`u_${s.name}`), pv(s.name));
        gl.bindFramebuffer(gl.FRAMEBUFFER, L.src!.fbo);
        gl.viewport(0, 0, L.w, L.h);
        gl.disable(gl.BLEND);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        src = L.src!.tex;
      }
      // 2. the effect chain
      let cur = src;
      let ping = 0;
      for (const e of L.effects) {
        const orig = cur;
        e.programs.forEach((prog, i) => {
          const last = i === e.programs.length - 1;
          const dst = last && e.fb ? e.fb[1] : L.ping[ping]!;
          gl.useProgram(prog);
          const u = (n: string) => gl.getUniformLocation(prog, n);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cur); gl.uniform1i(u("u_in"), 0);
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, orig); gl.uniform1i(u("u_orig"), 1);
          gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, e.fb ? e.fb[0].tex : orig); gl.uniform1i(u("u_fb"), 2);
          gl.activeTexture(gl.TEXTURE0);
          gl.uniform2f(u("u_texel"), 1 / L.w, 1 / L.h);
          gl.uniform2f(u("u_res"), L.w, L.h);
          gl.uniform1f(u("u_time"), t);
          gl.uniform1f(u("u_fps"), fps);
          for (const s of e.def.params) gl.uniform1f(u(`u_${s.name}`), this.resolver.value(`${id}.${e.id}.${s.name}`, e.params[s.name]!, t, lookup));
          gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
          gl.viewport(0, 0, L.w, L.h);
          gl.disable(gl.BLEND);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          cur = dst.tex;
          if (!(last && e.fb)) ping = 1 - ping;
        });
        if (e.fb) e.fb.reverse(); // this frame's output becomes next frame's feedback
      }
      if (this.timing) this.timing[id] = (this.timing[id] ?? 0) + performance.now() - t0;
      finals.push(opacity > 0.001 ? cur : null);
    });
    if (!output) return;
    // 3. composite the layers onto the output
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.out.fbo);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.progLayer);
    const u = (n: string) => gl.getUniformLocation(this.progLayer, n);
    gl.uniform1i(u("tex"), 0);
    gl.activeTexture(gl.TEXTURE0);
    this.layers.forEach((L, i) => {
      const tex = finals[i];
      if (!tex) return;
      const id = L.def.id;
      const base = layoutFor(L.def, this.profile.layout);
      const pv = (name: string, fallback: number) => this.resolver.value(`${id}.${name}`, L.def.params?.[name] ?? fallback, t, lookup);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // All layer textures keep the image's top row at t=0 (canvas uploads, and GPU passes by construction).
      gl.uniform2f(u("centre"), pv("x", base.x) * 2 - 1, 1 - pv("y", base.y) * 2);
      gl.uniform2f(u("halfSize"), pv("w", base.w), pv("h", base.h));
      gl.uniform1f(u("rot"), (pv("rotation", base.rotation ?? 0) * Math.PI) / 180);
      gl.uniform1f(u("aspect"), width / height);
      gl.uniform1f(u("opacity"), Math.min(1, pv("opacity", L.def.opacity ?? 1)));
      this.setBlend(L.def.blend ?? "normal");
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });
    // 4. post: background colour, vignette, film grain (seeded per frame)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.progPost);
    gl.bindTexture(gl.TEXTURE_2D, this.out.tex);
    const up = (n: string) => gl.getUniformLocation(this.progPost, n);
    gl.uniform3f(up("bg"), ...bg);
    gl.uniform1f(up("grain"), this.resolver.value("post.grain", 0.05, t, lookup));
    gl.uniform1f(up("vignette"), this.resolver.value("post.vignette", 0.55, t, lookup));
    gl.uniform1f(up("seed"), (Math.floor(frame) % 997) * 0.731);
    gl.uniform2f(up("res"), width, height);
    gl.uniform2f(up("centre"), 0, 0);
    gl.uniform2f(up("halfSize"), 1, 1);
    gl.uniform1f(up("rot"), 0);
    gl.uniform1f(up("aspect"), 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  bench(start: number, count: number): BenchStats {
    const gl = this.gl;
    // Warm up shaders, caches and JIT on the frames just before `start`, so the timed run is continuous
    // (otherwise the first timed frame would include the feedback lead-in after the jump).
    for (let f = Math.max(0, start - 10); f < start; f++) this.renderFrame(f);
    gl.finish();
    this.timing = {};
    const times: { f: number; ms: number }[] = [];
    for (let f = start; f < start + count; f++) {
      const t0 = performance.now();
      this.renderFrame(f);
      gl.finish();
      times.push({ f, ms: performance.now() - t0 });
    }
    const layersMs = Object.fromEntries(Object.entries(this.timing).map(([k, v]) => [k, v / count]));
    this.timing = null;
    return benchStats(times, layersMs);
  }

  /** RGBA pixels of the last frame, bottom row first (as WebGL returns them). */
  readPixels(): Uint8Array {
    const gl = this.gl;
    gl.readPixels(0, 0, this.profile.width, this.profile.height, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
    return this.pixels;
  }
}
