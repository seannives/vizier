/**
 * Frame pacing from requestAnimationFrame timestamps. The display refresh interval is estimated as the
 * median gap; a gap of n intervals means n-1 frames were dropped (the screen showed the old frame again).
 */
export class FrameStats {
  private gaps: number[] = [];
  private draws: number[] = [];
  private drops: number[] = []; // timestamps of dropped frames
  private last = 0;
  dropped = 0;
  private now = 0;

  reset() { this.gaps = []; this.draws = []; this.drops = []; this.dropped = 0; this.last = 0; }

  frame(now: number, drawMs: number) {
    this.now = now;
    if (this.last) {
      const gap = now - this.last;
      this.gaps.push(gap);
      if (this.gaps.length > 240) this.gaps.shift();
      const interval = this.interval();
      if (this.gaps.length >= 30) {
        const missed = Math.max(0, Math.round(gap / interval) - 1);
        for (let i = 0; i < missed; i++) this.drops.push(now);
        this.dropped += missed;
      }
    }
    this.last = now;
    this.draws.push(drawMs);
    if (this.draws.length > 600) this.draws.shift();
  }

  private interval(): number {
    if (!this.gaps.length) return 1000 / 60;
    const s = [...this.gaps].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  }

  summary() {
    const iv = this.interval();
    const recent = this.gaps.slice(-60);
    const avgGap = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : iv;
    const d = [...this.draws].sort((a, b) => a - b);
    this.drops = this.drops.filter((t) => this.now - t < 10_000);
    return {
      refreshHz: 1000 / iv,
      fps: 1000 / avgGap,
      dropped: this.dropped,
      droppedRecent: this.drops.length,
      drawAvg: d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0,
      drawP99: d.length ? d[Math.floor(d.length * 0.99)]! : 0,
    };
  }
}
