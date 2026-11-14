/** Seeded PRNG (mulberry32). Scenes must use this, never Math.random, so frames are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh generator per (seed, frame, salt): any frame can be rendered without the frames before it. */
export const frameRng = (seed: number, frame: number, salt = 0) => mulberry32((seed * 73856093) ^ (frame * 19349663) ^ (salt * 83492791));
