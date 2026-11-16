/**
 * Synthesises the demo project's audio: a 32-bar, 128 BPM techno sketch with a 0.75 s lead-in before bar 1.
 *   bars 1–8 intro (drums) · 9–24 groove (+ bass) · 25–28 break (pad) · 29–32 outro (all)
 * Deterministic, so tests can rely on it.
 */
export const DEMO = { sampleRate: 48000, bpm: 128, bars: 32, leadIn: 0.75, tail: 1.5 };

export function makeDemoTracks(): Record<"drums" | "bass" | "pad" | "mix", Float32Array> {
  const { sampleRate: sr, bpm, bars, leadIn, tail } = DEMO;
  const beat = 60 / bpm, bar = 4 * beat;
  const n = Math.round((leadIn + bars * bar + tail) * sr);
  const drums = new Float32Array(n), bass = new Float32Array(n), pad = new Float32Array(n);
  let seed = 1;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const at = (barNo: number, beatNo = 0) => leadIn + (barNo - 1) * bar + beatNo * beat; // bar 1 = first downbeat
  const add = (buf: Float32Array, t0: number, len: number, f: (t: number) => number) => {
    const a = Math.round(t0 * sr), z = Math.min(n, a + Math.round(len * sr));
    for (let i = a; i < z; i++) buf[i]! += f((i - a) / sr);
  };
  const inSection = (b: number, ...ranges: [number, number][]) => ranges.some(([x, y]) => b >= x && b <= y);
  for (let b = 1; b <= bars; b++) {
    const drumsOn = inSection(b, [1, 24], [29, 32]);
    const bassOn = inSection(b, [9, 24], [29, 32]);
    const padOn = inSection(b, [25, 32]);
    for (let q = 0; q < 4; q++) {
      if (drumsOn) {
        add(drums, at(b, q), 0.35, (t) => 0.9 * Math.sin(2 * Math.PI * (50 + 120 * Math.exp(-t * 30)) * t) * Math.exp(-t * 9)); // kick
        add(drums, at(b, q + 0.5), 0.06, (t) => 0.25 * rnd() * Math.exp(-t * 60)); // off-beat hat
      }
      if (bassOn) {
        const notes = [36, 36, 48, 39];
        const hz = 440 * 2 ** ((notes[q]! - 69) / 12);
        for (const s of [0.25, 0.75]) add(bass, at(b, q + s), beat * 0.22, (t) => {
          const saw = 2 * ((t * hz) % 1) - 1;
          return 0.45 * saw * Math.exp(-t * 14) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.5 * (at(b) + t)));
        });
      }
    }
    if (padOn) {
      const chord = b % 2 ? [57, 60, 64] : [55, 59, 62];
      add(pad, at(b), bar, (t) => {
        const env = Math.min(1, t / 0.4) * Math.min(1, (bar - t) / 0.3);
        return chord.reduce((s, m) => s + 0.12 * Math.sin(2 * Math.PI * 440 * 2 ** ((m - 69) / 12) * t), 0) * env;
      });
    }
  }
  const mix = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) { mix[i] = drums[i]! + bass[i]! + pad[i]!; peak = Math.max(peak, Math.abs(mix[i]!)); }
  const g = 0.89 / (peak || 1);
  for (const buf of [mix, drums, bass, pad]) for (let i = 0; i < n; i++) buf[i]! *= g;
  return { drums, bass, pad, mix };
}

/** 16-bit PCM WAV. */
export function wav(samples: Float32Array, sampleRate: number): Buffer {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), 44 + i * 2);
  return b;
}
