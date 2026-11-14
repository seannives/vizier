import { fft } from "./fft.ts";

/** One video frame's worth of audio features. All values are 0..1 unless noted. */
export interface FeatureFrame {
  rms: number;      // loudness of the window, dBFS mapped -80..0 → 0..1
  env: number;      // rms smoothed with attack/release (what visuals usually want)
  low: number;      // 20–150 Hz
  lowMid: number;   // 150–600 Hz
  mid: number;      // 600–3 kHz
  high: number;     // 3–16 kHz
  centroid: number; // spectral centroid, log-mapped 50 Hz..10 kHz → 0..1 (a 303's filter sweep)
  flux: number;     // spectral flux (change in spectrum), normalised
  onset: number;    // 1 on a detected onset frame, else 0
  spectrum: Float32Array; // `bins` log-spaced bands, dB mapped -80..0 → 0..1
}

export interface AnalyzerOptions {
  sampleRate: number;
  fps: number;
  fftSize?: number;       // default 2048
  bins?: number;          // default 32
  attackMs?: number;      // env attack, default 10
  releaseMs?: number;     // env release, default 250
  onsetSensitivity?: number; // multiplier over the running mean flux, default 1.6
}

const FLOOR_DB = -80;
const db01 = (power: number) => {
  const db = 10 * Math.log10(power + 1e-12);
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));
};

/**
 * Causal, stateful analyzer: feed it the window of samples centred on each frame, in order.
 * Causal on purpose, so the offline renderer and a live AudioWorklet produce identical features.
 */
export class FrameAnalyzer {
  readonly fftSize: number;
  readonly bins: number;
  private readonly sr: number;
  private readonly window: Float32Array;
  private readonly re: Float32Array;
  private readonly im: Float32Array;
  private readonly binEdges: number[];
  private prevMag: Float32Array | null = null;
  private env = 0;
  private readonly attack: number;
  private readonly release: number;
  private readonly fluxHistory: number[] = [];
  private readonly sensitivity: number;
  private lastOnsetFrame = -Infinity;
  private frame = 0;
  private readonly minOnsetGap: number;
  private fluxScale = 1e-6;

  constructor(opts: AnalyzerOptions) {
    this.sr = opts.sampleRate;
    this.fftSize = opts.fftSize ?? 2048;
    this.bins = opts.bins ?? 32;
    this.window = new Float32Array(this.fftSize).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.fftSize - 1)));
    this.re = new Float32Array(this.fftSize);
    this.im = new Float32Array(this.fftSize);
    const dt = 1000 / opts.fps;
    this.attack = 1 - Math.exp(-dt / (opts.attackMs ?? 10));
    this.release = 1 - Math.exp(-dt / (opts.releaseMs ?? 250));
    this.sensitivity = opts.onsetSensitivity ?? 1.6;
    this.minOnsetGap = Math.max(1, Math.round(opts.fps * 0.06)); // ≤ ~16 onsets/s
    const lo = Math.log(30), hi = Math.log(16000);
    this.binEdges = Array.from({ length: this.bins + 1 }, (_, i) => Math.exp(lo + ((hi - lo) * i) / this.bins));
  }

  private bandPower(mag2: Float32Array, f0: number, f1: number): number {
    const hz = this.sr / this.fftSize;
    let a = Math.max(1, Math.floor(f0 / hz)), b = Math.min(mag2.length - 1, Math.ceil(f1 / hz));
    if (b < a) b = a;
    let s = 0;
    for (let k = a; k <= b; k++) s += mag2[k]!;
    return s;
  }

  /** `samples` must hold exactly fftSize mono samples (zero-padded at the edges of the file). */
  process(samples: Float32Array): FeatureFrame {
    const n = this.fftSize;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const s = samples[i]!;
      sumSq += s * s;
      this.re[i] = s * this.window[i]!;
      this.im[i] = 0;
    }
    fft(this.re, this.im);
    const half = n / 2;
    // Power normalised so a full-scale sine reads about 0 dB.
    const norm = 4 / (n * n * 0.25);
    const mag2 = new Float32Array(half);
    for (let k = 0; k < half; k++) mag2[k] = (this.re[k]! ** 2 + this.im[k]! ** 2) * norm;

    const rms = db01(sumSq / n);
    this.env += (rms - this.env) * (rms > this.env ? this.attack : this.release);

    const low = db01(this.bandPower(mag2, 20, 150));
    const lowMid = db01(this.bandPower(mag2, 150, 600));
    const mid = db01(this.bandPower(mag2, 600, 3000));
    const high = db01(this.bandPower(mag2, 3000, 16000));

    let wsum = 0, psum = 0;
    const hz = this.sr / n;
    for (let k = 1; k < half; k++) { wsum += k * hz * mag2[k]!; psum += mag2[k]!; }
    const c = psum > 1e-10 ? wsum / psum : 50;
    const centroid = Math.min(1, Math.max(0, Math.log(Math.max(c, 50) / 50) / Math.log(10000 / 50)));

    const spectrum = new Float32Array(this.bins);
    for (let b = 0; b < this.bins; b++) spectrum[b] = db01(this.bandPower(mag2, this.binEdges[b]!, this.binEdges[b + 1]!) / 1);

    // Spectral flux on log-magnitude, half-wave rectified.
    const mag = new Float32Array(half);
    for (let k = 0; k < half; k++) mag[k] = Math.log1p(1000 * Math.sqrt(mag2[k]!));
    let fluxRaw = 0;
    if (this.prevMag) for (let k = 0; k < half; k++) { const d = mag[k]! - this.prevMag[k]!; if (d > 0) fluxRaw += d; }
    this.prevMag = mag;
    this.fluxScale = Math.max(this.fluxScale * 0.999, fluxRaw);
    const flux = fluxRaw / this.fluxScale;

    const hist = this.fluxHistory;
    const mean = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : Infinity;
    let onset = 0;
    if (fluxRaw > mean * this.sensitivity && fluxRaw > 1 && this.frame - this.lastOnsetFrame >= this.minOnsetGap && rms > 0.15) {
      onset = 1;
      this.lastOnsetFrame = this.frame;
    }
    hist.push(fluxRaw);
    if (hist.length > 16) hist.shift();
    this.frame++;
    return { rms, env: this.env, low, lowMid, mid, high, centroid, flux, onset, spectrum };
  }
}
