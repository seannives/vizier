import type { Doc } from "./session.ts";
import type { RenderJob, RenderFile } from "../../renders.ts";
export type { RenderJob, RenderFile };
import type { FeatureTrack } from "../../../../../packages/features/src/index.ts";

export interface SessionData extends Doc { id: string; initialVideo: string | null }
export interface Waveform { rate: number; duration: number; peaks: Int8Array }

/** Fetch JSON; a server error becomes an exception with the server's message. */
async function getJson(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body?.error) throw new Error(`${url.split("?")[0]}: ${body?.error ?? r.statusText}`);
  return body;
}

export const api = {
  /** The open project, or `noProject` when the editor was started without one. */
  async session(): Promise<SessionData | { noProject: true }> { return getJson("/api/session"); },
  async waveform(file: string): Promise<Waveform> {
    const w = await getJson(`/api/waveform?file=${encodeURIComponent(file)}`);
    const bin = atob(w.peaks);
    const peaks = new Int8Array(bin.length);
    for (let i = 0; i < bin.length; i++) peaks[i] = (bin.charCodeAt(i) << 24) >> 24;
    return { rate: w.rate, duration: w.duration, peaks };
  },
  /** Every track's features at a frame rate (the open video's); `tracks` is id → file. */
  async features(fps: number, tracks?: Record<string, string>): Promise<Record<string, FeatureTrack>> {
    return getJson(`/api/features?fps=${fps}${tracks ? `&tracks=${encodeURIComponent(JSON.stringify(tracks))}` : ""}`);
  },
  /** Keep a dropped audio file (in media/.incoming until the project is saved); its path in the project. */
  async upload(file: File): Promise<string> {
    const r = await getJson(`/api/upload?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
    return r.file;
  },
  /** The tempo and where bar 1 starts, worked out from a file (the mix), with other likely tempos. */
  async tempo(file: string): Promise<{ bpm: number; downbeat: number; beatsPerBar: number; candidates: { bpm: number; score: number }[] }> {
    return getJson(`/api/tempo?file=${encodeURIComponent(file)}`);
  },
  /** Renders: the queue for this project, and the files in its output/ folder. */
  async renders(): Promise<{ jobs: RenderJob[]; files: RenderFile[] }> { return getJson("/api/render"); },
  async render(videos: string[], whole: boolean, options?: string[]): Promise<{ jobs: RenderJob[] }> {
    return getJson("/api/render", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ videos, whole, options }) });
  },
  async cancelRender(id: number) { return getJson("/api/render/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }); },
  async reveal(file: string) { return getJson("/api/reveal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file }) }); },
  outputUrl: (file: string) => `/api/output?file=${encodeURIComponent(file)}`,
  /** The audio files in media/. */
  async media(): Promise<{ file: string; bytes: number }[]> { return getJson("/api/media"); },
  /** A track's length, the mix's, and how far the track is shifted against the mix (seconds; null: can't tell). */
  async trackCheck(file: string, mix: string): Promise<{ seconds: number; mixSeconds: number; offset: number | null }> {
    return getJson(`/api/trackcheck?file=${encodeURIComponent(file)}&mix=${encodeURIComponent(mix)}`);
  },
  audioUrl: (file: string) => `/api/audio?file=${encodeURIComponent(file)}`,
  /** `moved`: dropped files the save moved into media/ (old path → new). */
  async save(payload: object): Promise<{ written?: string[]; moved?: Record<string, string>; error?: string }> {
    const r = await fetch("/api/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    return r.json();
  },
};
