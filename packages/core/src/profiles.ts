/** Output formats. A profile picks canvas size, frame rate, encoder settings and which layout to use. */
export type LayoutFamily = "landscape" | "portrait" | "feed";

export interface OutputProfile {
  id: string;
  label: string;
  width: number;
  height: number;
  fps: number;
  layout: LayoutFamily;
  /** Safe area as fractions of the canvas, for guides (e.g. the 4:5 feed crop of a 9:16 Reel). */
  safeArea?: { x: number; y: number; w: number; h: number };
  videoBitrateMbps: number;
}

export const PROFILES: Record<string, OutputProfile> = {
  youtube: { id: "youtube", label: "YouTube 1080p", width: 1920, height: 1080, fps: 30, layout: "landscape", videoBitrateMbps: 12 },
  youtube60: { id: "youtube60", label: "YouTube 1080p60", width: 1920, height: 1080, fps: 60, layout: "landscape", videoBitrateMbps: 16 },
  youtube4k: { id: "youtube4k", label: "YouTube 4K", width: 3840, height: 2160, fps: 30, layout: "landscape", videoBitrateMbps: 45 },
  shorts: { id: "shorts", label: "YouTube Shorts", width: 1080, height: 1920, fps: 30, layout: "portrait", videoBitrateMbps: 10 },
  reels: {
    id: "reels", label: "Instagram Reels", width: 1080, height: 1920, fps: 30, layout: "portrait", videoBitrateMbps: 10,
    // Instagram shows Reels in the feed as a centred 4:5 crop: keep key content inside this box.
    safeArea: { x: 0, y: (1920 - 1350) / 2 / 1920, w: 1, h: 1350 / 1920 },
  },
  igfeed: { id: "igfeed", label: "Instagram feed 4:5", width: 1080, height: 1350, fps: 30, layout: "feed", videoBitrateMbps: 10 },
  // Live: what the projector window renders. Features are analysed at this frame rate.
  live: { id: "live", label: "Live 1080p60", width: 1920, height: 1080, fps: 60, layout: "landscape", videoBitrateMbps: 0 },
  live720: { id: "live720", label: "Live 720p60", width: 1280, height: 720, fps: 60, layout: "landscape", videoBitrateMbps: 0 },
  draft: { id: "draft", label: "Draft 540p", width: 960, height: 540, fps: 30, layout: "landscape", videoBitrateMbps: 4 },
};

export function getProfile(id: string): OutputProfile {
  const p = PROFILES[id];
  if (!p) throw new Error(`Unknown profile "${id}". Known: ${Object.keys(PROFILES).join(", ")}`);
  return p;
}
