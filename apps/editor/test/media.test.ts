import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storeUpload, settleMedia, listMedia, safeName, stemOffset, clearIncoming, INCOMING } from "../src/media.ts";
import type { SongFile } from "../../../packages/core/src/index.ts";

let dir: string;
const song = (tracks: [string, string][]): SongFile => ({
  version: 2, title: "t", grid: { tempo: [{ bar: 1, bpm: 120, beatsPerBar: 4 }], downbeat: 0 },
  tracks: tracks.map(([id, file], i) => ({ id, name: id, file, ...(i === 0 ? { mix: true } : {}) })),
} as SongFile);
const put = (file: string, text: string) => writeFileSync(join(dir, file), text);
const read = (file: string) => readFileSync(join(dir, file), "utf8");
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "vizier-media-")); mkdirSync(join(dir, "media")); });

describe("dropped files", () => {
  it("wait in media/.incoming under their own (made safe) name", () => {
    const f = storeUpload(dir, "Bass bounce #3.wav", new TextEncoder().encode("new"));
    expect(f).toMatch(new RegExp(`^${INCOMING}/\\d+/Bass bounce _3\\.wav$`));
    expect(read(f)).toBe("new");
    expect(safeName("../../etc/passwd.wav")).toBe("passwd.wav");
    expect(() => storeUpload(dir, "notes.txt", new Uint8Array([1]))).toThrow(/isn't an audio file/);
  });
  it("the files in media/ are listed, not the ones waiting", () => {
    put("media/a.wav", "a"); storeUpload(dir, "b.wav", new Uint8Array([1]));
    expect(listMedia(dir).map((m) => m.file)).toEqual(["media/a.wav"]);
    clearIncoming(dir);
    expect(existsSync(join(dir, INCOMING))).toBe(false);
  });
});

describe("saving moves dropped files into media/", () => {
  it("a replacement with the same name overwrites the track's old file", () => {
    put("media/mix.wav", "mix"); put("media/bass.wav", "old");
    const before = song([["mix", "media/mix.wav"], ["bass", "media/bass.wav"]]);
    const f = storeUpload(dir, "bass.wav", new TextEncoder().encode("new"));
    const { song: s, moved, deleted } = settleMedia(dir, before, song([["mix", "media/mix.wav"], ["bass", f]]));
    expect(s.tracks[1]!.file).toBe("media/bass.wav");
    expect(read("media/bass.wav")).toBe("new");
    expect(moved).toEqual({ [f]: "media/bass.wav" });
    expect(deleted).toEqual([]);
    expect(readdirSync(join(dir, INCOMING))).toEqual([]);           // nothing left waiting
  });
  it("a replacement with another name: the old file goes (nothing else uses it)", () => {
    put("media/mix.wav", "mix"); put("media/bass.wav", "old");
    const before = song([["mix", "media/mix.wav"], ["bass", "media/bass.wav"]]);
    const f = storeUpload(dir, "bass v2.wav", new TextEncoder().encode("new"));
    const { song: s, deleted } = settleMedia(dir, before, song([["mix", "media/mix.wav"], ["bass", f]]));
    expect(s.tracks[1]!.file).toBe("media/bass v2.wav");
    expect(deleted).toEqual(["media/bass.wav"]);
    expect(existsSync(join(dir, "media/bass.wav"))).toBe(false);
  });
  it("a new track never overwrites another file of the same name", () => {
    put("media/mix.wav", "mix"); put("media/bass.wav", "bass");
    const before = song([["mix", "media/mix.wav"], ["bass", "media/bass.wav"]]);
    const f = storeUpload(dir, "bass.wav", new TextEncoder().encode("another"));
    const { song: s } = settleMedia(dir, before, song([["mix", "media/mix.wav"], ["bass", "media/bass.wav"], ["bass2", f]]));
    expect(s.tracks[2]!.file).toBe("media/bass-2.wav");
    expect(read("media/bass.wav")).toBe("bass");
  });
  it("a removed track's file stays (it can be added again from media/)", () => {
    put("media/mix.wav", "mix"); put("media/pad.wav", "pad");
    const { deleted } = settleMedia(dir, song([["mix", "media/mix.wav"], ["pad", "media/pad.wav"]]), song([["mix", "media/mix.wav"]]));
    expect(deleted).toEqual([]);
    expect(existsSync(join(dir, "media/pad.wav"))).toBe(true);
  });
});

describe("a stem against the mix", () => {
  const SR = 8000;
  // clicks at irregular times (a rhythm), as the mix; the stem is the same rhythm, shifted
  const hits = [0.3, 0.9, 1.25, 2.1, 2.4, 3.3, 3.95, 4.6, 5.1, 5.85, 6.7, 7.2, 8.05, 8.6, 9.4];
  const sig = (shift: number, len = 10) => {
    const x = new Float32Array(SR * len);
    for (const h of hits) { const s = Math.round((h + shift) * SR); for (let i = 0; i < 400 && s + i < x.length; i++) if (s + i >= 0) x[s + i] = Math.sin(i * 0.3) * Math.exp(-i / 100); }
    return x;
  };
  it("finds how late or early it is", () => {
    expect(stemOffset(sig(0), sig(0), SR)).toBeCloseTo(0, 2);
    expect(stemOffset(sig(0), sig(0.5), SR)).toBeCloseTo(0.5, 2);
    expect(stemOffset(sig(0), sig(-1.2), SR)).toBeCloseTo(-1.2, 2);
  });
  it("says nothing for a silent stem", () => {
    expect(stemOffset(sig(0), new Float32Array(SR * 10), SR)).toBeUndefined();
  });
});
