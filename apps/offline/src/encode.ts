import { spawn } from "node:child_process";

export interface EncoderOptions {
  out: string; width: number; height: number; fps: number;
  bitrateMbps?: number; audio?: string; audioStart?: number; duration?: number; still?: boolean;
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
        ...(o.audio ? ["-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-shortest"] : []),
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
