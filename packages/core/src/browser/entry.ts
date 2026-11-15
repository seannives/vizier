// Browser bundle entry: exposes the renderer to the offline driver (and, later, the live app).
import { Renderer } from "./renderer.ts";
import { FrameEncoder } from "./encoder.ts";
import type { Project } from "../project.ts";
import type { FeatureTrack } from "@vizier/features";

let r: Renderer | null = null;
let enc: FrameEncoder | null = null;
const b64 = (px: Uint8Array) => {
  let s = "";
  for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000) as unknown as number[]);
  return btoa(s);
};
(window as any).vizier = {
  async init(project: Project, profileId: string, tracks: Record<string, FeatureTrack>) {
    await document.fonts.load("40px 'Special Elite'");
    r = new Renderer(project, profileId, tracks);
    document.body.appendChild(r.canvas);
    return { width: r.profile.width, height: r.profile.height, fps: r.profile.fps };
  },
  render(frame: number) { r!.renderFrame(frame); },
  bench(start: number, count: number) { return r!.bench(start, count); },
  /** Render a frame and return its pixels as base64 (bottom row first). */
  renderAndRead(frame: number): string {
    r!.renderFrame(frame);
    return b64(r!.readPixels());
  },
  /** Start in-browser H.264 encoding (WebCodecs). */
  async encodeStart(bitrateMbps: number) {
    const p = r!.profile;
    enc = await FrameEncoder.create({ width: p.width, height: p.height, fps: p.fps, bitrateMbps });
    return enc.info;
  },
  /** Render and encode frames [start, start+count); returns the H.264 bytes produced so far, base64. */
  async encodeFrames(start: number, count: number, first: number): Promise<string> {
    for (let f = start; f < start + count; f++) {
      r!.renderFrame(f);
      await enc!.encode(r!.canvas, f - first, r!.profile.fps);
    }
    return b64(enc!.take());
  },
  async encodeFinish(): Promise<string> { const b = await enc!.finish(); enc = null; return b64(b); },
};
