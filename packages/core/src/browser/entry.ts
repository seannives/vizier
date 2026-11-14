// Browser bundle entry: exposes the renderer to the offline driver (and, later, the live app).
import { Renderer } from "./renderer.ts";
import type { Project } from "../project.ts";
import type { FeatureTrack } from "@vizier/features";

let r: Renderer | null = null;
(window as any).vizier = {
  async init(project: Project, profileId: string, tracks: Record<string, FeatureTrack>) {
    await document.fonts.load("40px 'Special Elite'");
    r = new Renderer(project, profileId, tracks);
    document.body.appendChild(r.canvas);
    return { width: r.profile.width, height: r.profile.height, fps: r.profile.fps };
  },
  render(frame: number) { r!.renderFrame(frame); },
  /** Render a frame and return its pixels as base64 (bottom row first). */
  renderAndRead(frame: number): string {
    r!.renderFrame(frame);
    const px = r!.readPixels();
    let s = "";
    const CH = 0x8000;
    for (let i = 0; i < px.length; i += CH) s += String.fromCharCode.apply(null, px.subarray(i, i + CH) as unknown as number[]);
    return btoa(s);
  },
};
