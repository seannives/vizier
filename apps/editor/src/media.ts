/**
 * The project's audio files, for the editor's tracks: files dropped on the editor, the files in media/, and
 * checking a stem against the mix.
 *
 * A dropped file waits in media/.incoming/ until the project is saved (so undo before saving leaves nothing
 * behind). Saving moves it into media/ under its own name; a file it replaces is overwritten, or deleted when the
 * replacement has another name and nothing else uses the old one.
 */
import { mkdirSync, writeFileSync, readdirSync, existsSync, renameSync, rmSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";
import type { SongFile } from "../../../packages/core/src/index.ts";

export const INCOMING = "media/.incoming";
export const AUDIO_EXT = [".wav", ".aif", ".aiff", ".flac", ".mp3", ".m4a", ".ogg"];

export const isAudio = (name: string) => AUDIO_EXT.includes(extname(name).toLowerCase());

/** A file name that's safe to write: no folders, only ordinary characters. */
export function safeName(name: string): string {
  const base = basename(name.replace(/\\/g, "/"));
  const ext = extname(base).toLowerCase();
  const stem = base.slice(0, base.length - extname(base).length).replace(/[^A-Za-z0-9 ._()-]+/g, "_").trim().replace(/^\.+/, "") || "audio";
  return stem + ext;
}

/** `name` if `taken` doesn't have it, else name-2, name-3… */
function unique(name: string, taken: (n: string) => boolean): string {
  if (!taken(name)) return name;
  const ext = extname(name), stem = name.slice(0, name.length - ext.length);
  for (let i = 2; ; i++) if (!taken(`${stem}-${i}${ext}`)) return `${stem}-${i}${ext}`;
}

/** Keep a dropped file until the project is saved. Returns its path relative to the project. */
export function storeUpload(dir: string, name: string, bytes: Uint8Array): string {
  const safe = safeName(name);
  if (!isAudio(safe)) throw new Error(`${name} isn't an audio file vizier reads (${AUDIO_EXT.join(", ")})`);
  if (!bytes.length) throw new Error(`${name} is empty`);
  const inc = join(dir, INCOMING);
  mkdirSync(inc, { recursive: true });
  // each upload gets a folder of its own, so the file keeps its name (it's the name it's saved under)
  const slot = unique("1", (n) => existsSync(join(inc, n)));
  mkdirSync(join(inc, slot));
  writeFileSync(join(inc, slot, safe), bytes);
  return `${INCOMING}/${slot}/${safe}`;
}

/** Drop files that were never saved (from an earlier session). */
export function clearIncoming(dir: string) { rmSync(join(dir, INCOMING), { recursive: true, force: true }); }

/** Audio files in media/ (not the ones waiting to be saved), as project paths, by name. */
export function listMedia(dir: string): { file: string; bytes: number }[] {
  const m = join(dir, "media");
  if (!existsSync(m)) return [];
  return readdirSync(m).filter((n) => !n.startsWith(".") && isAudio(n)).sort()
    .map((n) => ({ file: `media/${n}`, bytes: statSync(join(m, n)).size }));
}

/**
 * Saving the song: move each track's dropped file into media/ under the name it was dropped as, and point the
 * track at it. It overwrites the track's own old file of that name; if any other file in media/ has the name, it
 * gets -2, -3… The file a track used before is deleted when the track now has a different file and no track uses
 * the old one. A removed track's file stays.
 */
export function settleMedia(dir: string, before: SongFile, after: SongFile): { song: SongFile; moved: Record<string, string>; deleted: string[] } {
  const song: SongFile = structuredClone(after);
  const moved: Record<string, string> = {};
  const used = (file: string) => song.tracks.some((t) => t.file === file);
  for (const t of song.tracks) {
    if (!t.file.startsWith(`${INCOMING}/`)) continue;
    const prev = before.tracks.find((b) => b.id === t.id)?.file;
    const name = basename(t.file);
    // overwrite the track's own old file; never any other file already in media/ (pick a free name instead)
    const target = `media/${unique(name, (n) => `media/${n}` !== prev && existsSync(join(dir, "media", n)))}`;
    renameSync(join(dir, t.file), join(dir, target));
    moved[t.file] = target;
    t.file = target;
  }
  const deleted: string[] = [];
  for (const b of before.tracks) {
    const now = song.tracks.find((t) => t.id === b.id);
    if (!now || now.file === b.file || used(b.file)) continue;      // removed tracks keep their files
    if (!b.file.startsWith("media/") || !existsSync(join(dir, b.file))) continue;
    rmSync(join(dir, b.file));
    deleted.push(b.file);
  }
  for (const n of existsSync(join(dir, INCOMING)) ? readdirSync(join(dir, INCOMING)) : []) {
    const slot = join(dir, INCOMING, n);
    if (!readdirSync(slot).length) rmSync(slot, { recursive: true, force: true });
  }
  return { song, moved, deleted };
}

/**
 * How far a stem is shifted against the mix, in seconds (positive: the stem is late). Undefined when there's too
 * little in common to say (a silent stem, or nothing like the mix). Searches up to `maxShift` seconds either way.
 *
 * It compares two things at every shift: the song's shape (how loud each stretch is, as sections come and go),
 * and onsets (sudden rises in loudness). Onsets alone can't tell a drum loop from itself a bar later.
 */
export function stemOffset(mix: Float32Array, stem: Float32Array, sampleRate: number, maxShift = 8): number | undefined {
  const RATE = 100;                                                   // envelope frames per second
  const loud = (x: Float32Array) => {
    const per = Math.round(sampleRate / RATE), n = Math.floor(x.length / per);
    const e = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = i * per; j < (i + 1) * per; j++) s += x[j]! * x[j]!; e[i] = Math.sqrt(s / per); }
    return e;
  };
  const centred = (x: Float32Array) => { let m = 0; for (const v of x) m += v; m /= Math.max(1, x.length); return x.map((v) => v - m); };
  const onsets = (e: Float32Array) => centred(e.map((v, i) => (i ? Math.max(0, v - e[i - 1]!) : 0)));
  // loudness smoothed over half a second: the shape of the arrangement
  const shape = (e: Float32Array) => { const w = 50, o = new Float32Array(e.length); let s = 0;
    for (let i = 0; i < e.length; i++) { s += e[i]!; if (i >= w) s -= e[i - w]!; o[i] = s / Math.min(i + 1, w); } return centred(o); };
  /** Correlation of a with b shifted by k frames, normalised (−1…1), for k in [from, to]. */
  const corr = (a: Float32Array, b: Float32Array, from: number, to: number) => {
    const out: { k: number; r: number }[] = [];
    for (let k = from; k <= to; k++) {
      let s = 0, aa = 0, bb = 0;
      for (let i = Math.max(0, -k); i < a.length && i + k < b.length; i++) { const x = a[i]!, y = b[i + k]!; s += x * y; aa += x * x; bb += y * y; }
      out.push({ k, r: aa && bb ? s / Math.sqrt(aa * bb) : 0 });
    }
    return out;
  };
  const ea = loud(mix), eb = loud(stem);
  const max = Math.round(maxShift * RATE);
  // Each place is scored on both: the shape rules out a bar's worth of shift (a loop matches itself there), the
  // onsets pin it to 10 ms. A stem can match the mix only loosely (a hi-hat stem under a kick-heavy mix), so what
  // counts is a clear winner: well above any place half a second or more away.
  const sh = corr(shape(ea), shape(eb), -max, max), on = corr(onsets(ea), onsets(eb), -max, max);
  const peak = (xs: { r: number }[]) => Math.max(...xs.map((x) => x.r));
  const ps = peak(sh), po = peak(on);
  if (!(ps > 0.03) || !(po > 0.03)) return undefined;                   // nothing in common
  // each scaled to its own best match, so neither swamps the other
  const rs = sh.map((x, i) => ({ k: x.k, r: x.r / ps + on[i]!.r / po }));
  const top = rs.reduce((p, q) => (q.r > p.r ? q : p));
  const rival = rs.filter((x) => Math.abs(x.k - top.k) > RATE / 2).reduce((p, q) => (q.r > p.r ? q : p), { k: 0, r: 0 });
  if (top.r < 1.15 * rival.r) return undefined;
  return top.k / RATE;
}
