/** The first frame at or after a time (in seconds), so a video or still that starts on a bar shows that bar: a
 *  change held from the downbeat is on its first frame, not on the frame before. */
export function frameAtOrAfter(seconds: number, fps: number): number {
  return Math.max(0, Math.ceil(seconds * fps - 1e-6));
}
