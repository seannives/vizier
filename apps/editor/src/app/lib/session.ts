/**
 * The editing session: the project's files as data, with undo/redo and unsaved-change tracking.
 * Plain TypeScript, no UI framework: the editor (and later an output window) are views of a session.
 */
import { buildProject, resolveVideo, type Project, type SongFile, type VideoFile } from "../../../../../packages/core/src/index.ts";

export interface Doc { song: SongFile; videos: Record<string, VideoFile> }
interface Entry { doc: Doc; label: string; merge?: string }

const fileKey = (name: string) => `videos/${name}.json`;
const fileJsons = (d: Doc): Record<string, string> => ({
  "song.json": JSON.stringify(d.song),
  ...Object.fromEntries(Object.entries(d.videos).map(([n, v]) => [fileKey(n), JSON.stringify(v)])),
});

export class Session {
  private history: Entry[];
  private index = 0;
  private saved: Record<string, string>;
  private listeners = new Set<() => void>();
  static readonly LIMIT = 500;

  constructor(doc: Doc) {
    this.history = [{ doc: structuredClone(doc), label: "open" }];
    this.saved = fileJsons(doc);
  }

  get doc(): Doc { return this.history[this.index]!.doc; }

  /**
   * Make one undoable change. `mutate` edits a copy; nothing happens if it changed nothing.
   * `merge`: changes with the same merge key in a row (dragging a slider) are one undo step, until `seal()`.
   */
  apply(label: string, mutate: (draft: Doc) => void, opts: { merge?: string } = {}): boolean {
    const draft = structuredClone(this.doc);
    mutate(draft);
    if (JSON.stringify(draft) === JSON.stringify(this.doc)) return false;
    const last = this.history[this.index]!;
    if (opts.merge && last.merge === opts.merge && this.index === this.history.length - 1 && this.index > 0) {
      this.history[this.index] = { doc: draft, label, merge: opts.merge };
      this.emit();
      return true;
    }
    if (last.merge) last.merge = undefined;
    this.history = this.history.slice(0, this.index + 1);
    this.history.push({ doc: draft, label, merge: opts.merge });
    if (this.history.length > Session.LIMIT) this.history.shift();
    this.index = this.history.length - 1;
    this.emit();
    return true;
  }

  /** End a run of merged changes (the slider was let go): the next change is a new undo step. */
  seal() { const last = this.history[this.index]; if (last) last.merge = undefined; }

  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.history.length - 1; }
  /** Label of the change undo would revert, e.g. "set range". */
  get undoLabel() { return this.canUndo ? this.history[this.index]!.label : null; }
  get redoLabel() { return this.canRedo ? this.history[this.index + 1]!.label : null; }
  undo(): string | null { if (!this.canUndo) return null; this.seal(); const l = this.history[this.index]!.label; this.index--; this.emit(); return l; }
  redo(): string | null { if (!this.canRedo) return null; this.index++; this.emit(); return this.history[this.index]!.label; }

  /** Files that differ from what's on disk. */
  dirtyFiles(): string[] {
    const now = fileJsons(this.doc);
    return Object.keys(now).filter((k) => now[k] !== this.saved[k]);
  }
  get dirty() { return this.dirtyFiles().length > 0; }

  /** What to send to the server to save the unsaved files. */
  savePayload(): { song?: SongFile; videos?: Record<string, VideoFile> } {
    const dirty = new Set(this.dirtyFiles());
    const out: { song?: SongFile; videos?: Record<string, VideoFile> } = {};
    if (dirty.has("song.json")) out.song = this.doc.song;
    const vids = Object.entries(this.doc.videos).filter(([n]) => dirty.has(fileKey(n)));
    if (vids.length) out.videos = Object.fromEntries(vids);
    return out;
  }
  markSaved() { this.saved = fileJsons(this.doc); this.emit(); }

  /** Saving moved some audio files (dropped files into media/): point every track at the new path, through the
   *  whole undo history, so undo and redo never bring back a path that's gone. Not an undo step itself. */
  renameFiles(moved: Record<string, string>) {
    if (!Object.keys(moved).length) return;
    for (const e of this.history) for (const t of e.doc.song.tracks) if (moved[t.file]) t.file = moved[t.file]!;
    this.emit();
  }

  /** A video with its `base` chain resolved. */
  video(name: string): VideoFile {
    return resolveVideo(name, (n) => {
      const f = this.doc.videos[n];
      if (!f) throw new Error(`No video "${n}"`);
      return f;
    });
  }

  /** The renderer's view of a video. */
  project(video: string, trackPath: (file: string) => string = (f) => f): Project {
    return buildProject(this.doc.song, this.video(video), (t) => trackPath(t.file));
  }

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { for (const fn of this.listeners) fn(); }
}
