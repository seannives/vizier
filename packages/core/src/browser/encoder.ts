/**
 * In-browser H.264 encoding with WebCodecs. Frames go from the WebGL canvas straight to the encoder
 * (on a Mac: the hardware encoder), so only the compressed stream leaves Chrome. Output is Annex B
 * H.264, which ffmpeg muxes into an MP4 with the audio without re-encoding.
 */
export interface EncoderSettings { width: number; height: number; fps: number; bitrateMbps: number }
export interface EncoderInfo { codec: string; hardware: boolean | "unknown"; bitrateMbps: number }

/** H.264 High profile at the lowest level that fits the size and frame rate (Annex A of the H.264 spec). */
export function avcCodecFor(width: number, height: number, fps: number): string {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const levels: [number, number, number][] = [ // level_idc, max macroblocks per frame, max macroblocks per second
    [0x28, 8192, 245760], [0x2a, 8704, 522240], [0x32, 22080, 589824],
    [0x33, 36864, 983040], [0x34, 36864, 2073600], [0x3c, 139264, 4177920],
  ];
  const lvl = levels.find(([, fs, rate]) => mbs <= fs && mbs * fps <= rate) ?? levels[levels.length - 1]!;
  return `avc1.6400${lvl[0].toString(16).padStart(2, "0").toUpperCase()}`;
}

export class FrameEncoder {
  private encoder!: VideoEncoder;
  private pending: Uint8Array[] = [];
  private error: Error | null = null;
  private gop = 15;
  info!: EncoderInfo;

  static async create(s: EncoderSettings): Promise<FrameEncoder> {
    if (typeof VideoEncoder === "undefined") throw new Error("WebCodecs VideoEncoder is not available in this browser");
    const e = new FrameEncoder();
    const codec = avcCodecFor(s.width, s.height, s.fps);
    const base: VideoEncoderConfig = {
      codec, width: s.width, height: s.height, framerate: s.fps, bitrate: Math.round(s.bitrateMbps * 1e6),
      bitrateMode: "variable", latencyMode: "quality", avc: { format: "annexb" },
    };
    let config: VideoEncoderConfig | null = null;
    let hardware: boolean | "unknown" = "unknown";
    for (const [hw, label] of [["prefer-hardware", true], ["no-preference", "unknown"]] as const) {
      const c = { ...base, hardwareAcceleration: hw };
      if ((await VideoEncoder.isConfigSupported(c)).supported) { config = c; hardware = label; break; }
    }
    if (!config) throw new Error(`No H.264 encoder supports ${codec} ${s.width}x${s.height}@${s.fps}`);
    e.encoder = new VideoEncoder({
      output: (chunk) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); e.pending.push(b); },
      error: (err) => { e.error = err as Error; },
    });
    e.encoder.configure(config);
    e.gop = Math.max(1, Math.round(s.fps / 2)); // keyframe every half second, as YouTube recommends
    e.info = { codec, hardware, bitrateMbps: s.bitrateMbps };
    return e;
  }

  /** Encode the canvas's current image as frame `index`. Waits if the encoder falls behind. */
  async encode(canvas: HTMLCanvasElement, index: number, fps: number): Promise<void> {
    if (this.error) throw this.error;
    while (this.encoder.encodeQueueSize > 4) await new Promise((r) => this.encoder.addEventListener("dequeue", r, { once: true }));
    const frame = new VideoFrame(canvas, { timestamp: Math.round((index * 1e6) / fps), duration: Math.round(1e6 / fps) });
    this.encoder.encode(frame, { keyFrame: index % this.gop === 0 });
    frame.close();
  }

  /** Encoded bytes produced since the last call. */
  take(): Uint8Array {
    const n = this.pending.reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(n);
    let o = 0;
    for (const b of this.pending) { out.set(b, o); o += b.length; }
    this.pending = [];
    return out;
  }

  async finish(): Promise<Uint8Array> {
    await this.encoder.flush();
    if (this.error) throw this.error;
    this.encoder.close();
    return this.take();
  }
}
