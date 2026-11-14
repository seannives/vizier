import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { analyzeSignal, type FeatureTrack } from "../../../packages/features/src/index.ts";

export const SAMPLE_RATE = 48000;

/** Decode any audio file to mono float32 at 48 kHz with ffmpeg. */
export function decodeMono(path: string): Float32Array {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${path}: ${r.stderr}`);
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}

/** Analyse every stem at the render frame rate, caching results by file identity and settings. */
export async function loadFeatures(stems: Record<string, string>, fps: number, cacheDir = ".cache/features"): Promise<Record<string, FeatureTrack>> {
  mkdirSync(cacheDir, { recursive: true });
  const out: Record<string, FeatureTrack> = {};
  for (const [name, path] of Object.entries(stems)) {
    const st = statSync(path);
    const key = createHash("sha1").update(`${path}|${st.size}|${st.mtimeMs}|${fps}|v1`).digest("hex").slice(0, 16);
    const file = join(cacheDir, `${name}-${key}.json`);
    if (existsSync(file)) { out[name] = JSON.parse(readFileSync(file, "utf8")); continue; }
    const track = analyzeSignal(decodeMono(path), { sampleRate: SAMPLE_RATE, fps });
    writeFileSync(file, JSON.stringify(track));
    out[name] = track;
  }
  return out;
}
