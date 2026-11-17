/** Plays the mix and reports the song position of what's coming out of the speakers right now. */
export class Transport {
  private ctx = new AudioContext({ latencyHint: "interactive" });
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private offset = 0;
  playing = false;

  async load(url: string): Promise<number> {
    const data = await (await fetch(url)).arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(data);
    return this.buffer.duration;
  }
  get duration() { return this.buffer?.duration ?? 0; }
  private latency() { return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0); }

  /** Song position in seconds. */
  time(): number {
    if (!this.playing) return this.offset;
    return Math.max(0, this.offset + (this.ctx.currentTime - this.startedAt) - this.latency());
  }
  async play(from = this.offset) {
    if (!this.buffer) return;
    this.stopSource();
    await this.ctx.resume();
    this.offset = Math.min(Math.max(0, from), this.buffer.duration);
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.ctx.destination);
    this.startedAt = this.ctx.currentTime;
    this.source.start(0, this.offset);
    this.source.onended = () => { if (this.playing && this.time() >= this.duration - 0.05) { this.playing = false; this.offset = this.duration; } };
    this.playing = true;
  }
  stop() { if (this.playing) this.offset = this.time(); this.stopSource(); this.playing = false; }
  seek(t: number) { const was = this.playing; this.stopSource(); this.playing = false; this.offset = Math.min(Math.max(0, t), this.duration); if (was) void this.play(); }
  private stopSource() { if (this.source) { this.source.onended = null; try { this.source.stop(); } catch { /* already stopped */ } this.source = null; } }
}
