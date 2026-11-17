/** Plays the mix and reports the song position of what's coming out of the speakers right now. */
export class Transport {
  private ctx = new AudioContext({ latencyHint: "interactive" });
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private offset = 0;
  playing = false;
  /** Picture/sound sync correction in seconds: positive moves the playhead (and picture) later, negative earlier. */
  extraDelay = 0;

  async load(url: string): Promise<number> {
    const data = await (await fetch(url)).arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(data);
    return this.buffer.duration;
  }
  get duration() { return this.buffer?.duration ?? 0; }
  private latency() { return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0); }
  /** What Chrome says the output delay is (ms); the playhead already allows for this. */
  get reportedLatencyMs() { return Math.round(this.latency() * 1000); }

  /** Song position in seconds. */
  time(): number {
    if (!this.playing) return this.offset;
    // never report a time before where playback started (a positive offset would otherwise run the playhead backwards)
    return Math.max(this.offset, this.offset + (this.ctx.currentTime - this.startedAt) - this.latency() - this.extraDelay);
  }
  async play(from = this.offset) {
    if (!this.buffer) return;
    if (this.ctx.state !== "running") await this.ctx.resume();
    this.startSource(from);
  }
  /** Start the sound at `from` right now (the context must be running). Synchronous, so seeking while playing never
   *  leaves a moment where the transport looks stopped. */
  private startSource(from: number) {
    this.stopSource();
    this.offset = Math.min(Math.max(0, from), this.buffer!.duration);
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.ctx.destination);
    this.startedAt = this.ctx.currentTime;
    src.start(0, this.offset);
    src.onended = () => { if (this.source === src) { this.playing = false; this.offset = this.duration; this.source = null; } };
    this.source = src;
    this.playing = true;
  }
  stop() { if (this.playing) this.offset = this.time(); this.stopSource(); this.playing = false; }
  seek(t: number) {
    if (this.playing && this.buffer) this.startSource(t);
    else this.offset = Math.min(Math.max(0, t), this.duration);
  }
  private stopSource() { if (this.source) { this.source.onended = null; try { this.source.stop(); } catch { /* already stopped */ } this.source = null; } }
}
