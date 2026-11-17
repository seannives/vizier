import type { Doc } from "./session.ts";
import type { FeatureTrack } from "../../../../../packages/features/src/index.ts";

export interface SessionData extends Doc { id: string; initialVideo: string | null }
export interface Waveform { rate: number; duration: number; peaks: Int8Array }

export const api = {
  async session(): Promise<SessionData> { return (await fetch("/api/session")).json(); },
  async waveform(file: string): Promise<Waveform> {
    const w = await (await fetch(`/api/waveform?file=${encodeURIComponent(file)}`)).json();
    const bin = atob(w.peaks);
    const peaks = new Int8Array(bin.length);
    for (let i = 0; i < bin.length; i++) peaks[i] = (bin.charCodeAt(i) << 24) >> 24;
    return { rate: w.rate, duration: w.duration, peaks };
  },
  async features(video: string): Promise<Record<string, FeatureTrack>> {
    return (await fetch(`/api/features?video=${encodeURIComponent(video)}`)).json();
  },
  audioUrl: (file: string) => `/api/audio?file=${encodeURIComponent(file)}`,
  async save(payload: object): Promise<{ written?: string[]; error?: string }> {
    const r = await fetch("/api/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    return r.json();
  },
};
