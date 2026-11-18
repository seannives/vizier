import type { Doc } from "./session.ts";
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
  async session(): Promise<SessionData> { return getJson("/api/session"); },
  async waveform(file: string): Promise<Waveform> {
    const w = await getJson(`/api/waveform?file=${encodeURIComponent(file)}`);
    const bin = atob(w.peaks);
    const peaks = new Int8Array(bin.length);
    for (let i = 0; i < bin.length; i++) peaks[i] = (bin.charCodeAt(i) << 24) >> 24;
    return { rate: w.rate, duration: w.duration, peaks };
  },
  /** Every track's features at a frame rate (the open video's). */
  async features(fps: number): Promise<Record<string, FeatureTrack>> {
    return getJson(`/api/features?fps=${fps}`);
  },
  audioUrl: (file: string) => `/api/audio?file=${encodeURIComponent(file)}`,
  async save(payload: object): Promise<{ written?: string[]; error?: string }> {
    const r = await fetch("/api/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    return r.json();
  },
};
