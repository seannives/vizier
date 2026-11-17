import { describe, it, expect } from "vitest";
import { Session } from "../src/app/lib/session.ts";
import { snapToBeat } from "../src/app/lib/timeline.ts";
import type { SongFile, VideoFile } from "../../../packages/core/src/index.ts";

const song: SongFile = { version: 2, title: "t", tracks: [{ id: "mix", name: "Mix", file: "m.wav", mix: true }], grid: { tempo: [{ bar: 1, bpm: 120 }] } };
const full: VideoFile = { version: 2, format: "youtube", layers: [] };
const reel: VideoFile = { version: 2, base: "full", format: "reels" };

describe("Session", () => {
  it("applies changes, undoes and redoes them with labels", () => {
    const s = new Session({ song, videos: { full, reel } });
    expect(s.apply("set range", (d) => { d.videos.reel!.range = { from: 9, to: 17 }; })).toBe(true);
    expect(s.doc.videos.reel!.range).toEqual({ from: 9, to: 17 });
    expect(s.undoLabel).toBe("set range");
    expect(s.undo()).toBe("set range");
    expect(s.doc.videos.reel!.range).toBeUndefined();
    expect(s.redo()).toBe("set range");
    expect(s.doc.videos.reel!.range).toEqual({ from: 9, to: 17 });
  });
  it("ignores changes that change nothing, and a new change drops the redo history", () => {
    const s = new Session({ song, videos: { full } });
    expect(s.apply("noop", () => {})).toBe(false);
    s.apply("a", (d) => { d.videos.full!.seed = 1; });
    s.apply("b", (d) => { d.videos.full!.seed = 2; });
    s.undo();
    s.apply("c", (d) => { d.videos.full!.seed = 3; });
    expect(s.canRedo).toBe(false);
    expect(s.undo()).toBe("c");
    expect(s.undo()).toBe("a");
  });
  it("tracks unsaved files and builds the save payload", () => {
    const s = new Session({ song, videos: { full, reel } });
    expect(s.dirty).toBe(false);
    s.apply("x", (d) => { d.videos.reel!.range = { from: 1, to: 5 }; });
    expect(s.dirtyFiles()).toEqual(["videos/reel.json"]);
    expect(Object.keys(s.savePayload().videos!)).toEqual(["reel"]);
    expect(s.savePayload().song).toBeUndefined();
    s.markSaved();
    expect(s.dirty).toBe(false);
    s.undo(); // back to what's no longer on disk
    expect(s.dirtyFiles()).toEqual(["videos/reel.json"]);
  });
  it("never shares objects with what it was given or between history steps", () => {
    const videos = { full: structuredClone(full) };
    const s = new Session({ song, videos });
    s.apply("x", (d) => { d.videos.full!.seed = 9; });
    expect(videos.full.seed).toBeUndefined();
    s.undo();
    expect(s.doc.videos.full!.seed).toBeUndefined();
  });
  it("resolves videos built on others", () => {
    const s = new Session({ song, videos: { full: { ...full, seed: 4 }, reel } });
    expect(s.video("reel").format).toBe("reels");
    expect(s.project("reel").seed).toBe(4);
  });
});

describe("snapping", () => {
  it("snaps bar positions to the nearest beat", () => {
    const g = { tempo: [{ bar: 1, bpm: 120 }] };
    expect(snapToBeat(9.1, g)).toBe(9);
    expect(snapToBeat(9.2, g)).toBe(9.25);
    expect(snapToBeat(9.9, g)).toBe(10);
  });
});
