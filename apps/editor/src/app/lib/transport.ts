/**
 * One step of the playhead clock: advance the previous position by the display time that has passed (`now`, ms), and
 * pull it a little towards the audio clock's reading (`raw`, s), closing most of a difference within about a second.
 * It never steps backwards; a difference over 50 ms (a seek, a big sync change) is taken at once.
 */
export function smoothClock(prev: { at: number; t: number } | null, raw: number, now: number): { at: number; t: number } {
  if (!prev) return { at: now, t: raw };
  const dt = Math.max(0, (now - prev.at) / 1000);
  const predicted = prev.t + dt;
  const err = raw - predicted;
  if (Math.abs(err) > 0.05) return { at: now, t: raw };
  return { at: now, t: Math.max(prev.t, predicted + err * (1 - Math.exp(-dt / 0.3))) };
}

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
  /** How far what you hear trails the audio clock, as Chrome measures it (ms); the playhead allows for this. */
  get reportedLatencyMs() { return Math.round((this.ctx.currentTime - this.heardTime()) * 1000); }

  /**
   * The audio-clock time of the sound reaching the speakers right now. Chrome's getOutputTimestamp says which
   * context time was being played at which moment; that's more reliable than its reported latency, which some
   * outputs overstate. Falls back to currentTime − latency when the timestamp isn't available.
   */
  private heardTime(): number {
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime && ts.performanceTime) return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    return this.ctx.currentTime - this.latency();
  }
  /** Song position from the audio clock alone. It's accurate on average but jittery from one reading to the next
   *  (Chrome updates it once per audio buffer, and its timestamps wobble by a few ms). */
  private rawTime(): number {
    // never report a time before where playback started (a positive sync offset would otherwise run it backwards)
    return Math.max(this.offset, this.offset + (this.heardTime() - this.startedAt) - this.extraDelay);
  }
  private smooth: { at: number; t: number } | null = null;
  /** Song position in seconds (of what you're hearing), smoothed for drawing: it advances with the display clock and
   *  is pulled gently towards the audio clock, so the playhead moves evenly and never steps backwards while playing.
   *  A big difference (a seek, a large sync change) is taken at once. */
  time(): number {
    if (!this.playing) return this.offset;
    this.smooth = smoothClock(this.smooth, this.rawTime(), performance.now());
    return this.smooth.t;
  }
  /** Readings of the audio clock, for diagnosing sync. */
  clockInfo() {
    const ts = this.ctx.getOutputTimestamp?.();
    return {
      currentTime: this.ctx.currentTime, outputLatency: this.ctx.outputLatency, baseLatency: this.ctx.baseLatency,
      outputTimestamp: ts ? { contextTime: ts.contextTime, ageMs: ts.performanceTime ? performance.now() - ts.performanceTime : null } : null,
      heardLagMs: Math.round((this.ctx.currentTime - this.heardTime()) * 1000), state: this.ctx.state,
    };
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
    this.smooth = null;
    src.start(0, this.offset);
    src.onended = () => { if (this.source === src) { this.playing = false; this.offset = this.duration; this.source = null; } };
    this.source = src;
    this.playing = true;
  }
  stop() { if (this.playing) this.offset = this.time(); this.stopSource(); this.playing = false; this.smooth = null; }
  seek(t: number) {
    if (this.playing && this.buffer) this.startSource(t);
    else this.offset = Math.min(Math.max(0, t), this.duration);
  }
  private stopSource() { if (this.source) { this.source.onended = null; try { this.source.stop(); } catch { /* already stopped */ } this.source = null; } }
}
