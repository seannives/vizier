import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

export interface EncoderOptions {
  out: string; width: number; height: number; fps: number;
  bitrateMbps?: number; audio?: string; audioStart?: number; duration?: number; still?: boolean;
  /** Audio fade-in and fade-out, in seconds (see audioFades). */
  fadeIn?: number; fadeOut?: number;
}

/** The audio filter for the fades, if any: times are from the start of the (already trimmed) audio. */
export function fadeFilter(o: { duration?: number; fadeIn?: number; fadeOut?: number }): string[] {
  const f: string[] = [];
  if (o.fadeIn && o.fadeIn > 0) f.push(`afade=t=in:st=0:d=${o.fadeIn.toFixed(4)}`);
  if (o.fadeOut && o.fadeOut > 0 && o.duration) f.push(`afade=t=out:st=${Math.max(0, o.duration - o.fadeOut).toFixed(4)}:d=${o.fadeOut.toFixed(4)}`);
  return f.length ? ["-af", f.join(",")] : [];
}

/** The upload limit for a YouTube thumbnail; a cover is kept under it. */
export const COVER_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Write one frame (RGBA, bottom row first) as a JPEG cover, at the best quality that stays under the thumbnail
 * limit. Returns the quality used (ffmpeg's -q:v: 2 is best).
 */
export function writeCover(rgba: Buffer, width: number, height: number, out: string, maxBytes = COVER_MAX_BYTES): number {
  const margin = 0.95; // (the limit might be counted in decimal megabytes)
  for (const q of [2, 3, 4, 5, 7, 10, 14]) {
    const r = spawnSync("ffmpeg", ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-i", "pipe:0",
      "-vf", "vflip", "-frames:v", "1", "-q:v", String(q), "-f", "image2", "-c:v", "mjpeg", "-"], { input: rgba, maxBuffer: 1 << 28 });
    if (r.status !== 0) throw new Error(`ffmpeg failed writing the cover: ${r.stderr}`);
    if (r.stdout.length <= maxBytes * margin || q === 14) { writeFileSync(out, r.stdout); return q; }
  }
  return 14;
}

/** Pipe raw RGBA frames (bottom row first) into ffmpeg. MP4: H.264 High, yuv420p, AAC 48 kHz, faststart. */
export function startEncoder(o: EncoderOptions) {
  const input = ["-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${o.width}x${o.height}`, "-r", String(o.fps), "-i", "pipe:0"];
  const args = o.still
    ? ["-y", "-v", "error", ...input, "-vf", "vflip", "-frames:v", "1", o.out]
    : [
        "-y", "-v", "error", ...input,
        ...(o.audio ? ["-ss", String(o.audioStart ?? 0), "-t", String(o.duration), "-i", o.audio] : []),
        "-vf", "vflip",
        "-c:v", "libx264", "-profile:v", "high", "-preset", "veryfast", "-crf", "17",
        "-maxrate", `${(o.bitrateMbps ?? 12) * 2}M`, "-bufsize", `${(o.bitrateMbps ?? 12) * 4}M`,
        "-pix_fmt", "yuv420p", "-g", String(Math.round(o.fps / 2)), "-bf", "2",
        ...(o.audio ? [...fadeFilter(o), "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-shortest"] : []),
        "-movflags", "+faststart", o.out,
      ];
  const ff = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise<void>((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
  return {
    write(buf: Buffer) {
      return new Promise<void>((res) => (ff.stdin.write(buf) ? res() : ff.stdin.once("drain", () => res())));
    },
    async finish() { ff.stdin.end(); await done; },
  };
}

export interface MuxerOptions { out: string; fps: number; audio?: string; audioStart?: number; duration?: number; fadeIn?: number; fadeOut?: number }

/** Mux an Annex B H.264 stream (already encoded in the browser) with the audio into an MP4. No re-encode. */
export function startMuxer(o: MuxerOptions) {
  const args = [
    // Raw H.264 carries no reliable timestamps: give every frame one at a constant rate (-r as an input option).
    "-y", "-v", "error", "-fflags", "+genpts", "-r", String(o.fps), "-f", "h264", "-i", "pipe:0",
    ...(o.audio ? ["-ss", String(o.audioStart ?? 0), "-t", String(o.duration), "-i", o.audio] : []),
    "-map", "0:v", ...(o.audio ? ["-map", "1:a", ...fadeFilter(o), "-c:a", "aac", "-b:a", "320k", "-ar", "48000"] : []),
    "-c:v", "copy", "-movflags", "+faststart", o.out,
  ];
  const ff = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise<void>((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
  return {
    write(buf: Buffer) {
      if (!buf.length) return Promise.resolve();
      return new Promise<void>((res) => (ff.stdin.write(buf) ? res() : ff.stdin.once("drain", () => res())));
    },
    async finish() { ff.stdin.end(); await done; },
  };
}

/** Frame count and duration of a video file's first video stream, via ffprobe. */
export function probeVideo(path: string): { frames: number; duration: number; fps: number } {
  const r = spawnSync("ffprobe", ["-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets,duration,avg_frame_rate", "-of", "json", path], { encoding: "utf8" });
  const st = JSON.parse(r.stdout || "{}").streams?.[0] ?? {};
  const [n, d] = String(st.avg_frame_rate ?? "0/1").split("/").map(Number);
  return { frames: Number(st.nb_read_packets ?? 0), duration: Number(st.duration ?? 0), fps: d ? n! / d : 0 };
}
