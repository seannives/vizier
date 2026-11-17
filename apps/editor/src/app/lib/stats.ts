/** Frame timing for the performance readout (I): how evenly the display is being updated, and what the preview costs. */
const N = 240;
const intervals: number[] = [];
const previewMs: number[] = [];
let lastFrame = 0;
const push = (a: number[], v: number) => { a.push(v); if (a.length > N) a.shift(); };

export const stats = {
  /** Call once per animation frame with its timestamp. */
  frame(ts: number) { if (lastFrame && ts - lastFrame < 1000) push(intervals, ts - lastFrame); lastFrame = ts; },
  preview(ms: number) { push(previewMs, ms); },
  /** Over the last few seconds: display rate, the share of frames that came late (missed a refresh), preview cost. */
  summary() {
    const sorted = [...intervals].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1] ?? 0;
    const late = intervals.filter((d) => d > median * 1.5).length;
    const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
    return {
      hz: median ? Math.round(1000 / median) : 0,
      latePct: intervals.length ? Math.round((late / intervals.length) * 1000) / 10 : 0,
      worstFrameMs: Math.round((sorted[sorted.length - 1] ?? 0) * 10) / 10,
      previewAvgMs: Math.round(avg(previewMs) * 10) / 10,
      previewMaxMs: Math.round(Math.max(0, ...previewMs) * 10) / 10,
    };
  },
};
