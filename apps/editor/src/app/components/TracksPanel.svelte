<script lang="ts">
  import type { Doc } from "../lib/session.ts";
  import { renameTrack, moveTrack, trackNameFor } from "../lib/edits.ts";

  export interface TrackCheck { seconds: number; mixSeconds: number; offset: number | null }

  /**
   * The song's tracks (shared by every video): rename, reorder, replace, remove; add from a dropped file or from
   * media/. Dropping an audio file on a track's row replaces its audio; anywhere else in the editor adds a track.
   */
  let { doc, project = "", checks, media, edit, onadd, onreplace, onremove, onrefreshmedia }: {
    doc: Doc;
    /** The project's folder name (dismissed warnings are remembered per project, in this browser). */
    project?: string;
    /** Per track file: its length, the mix's, and its shift against the mix ("checking" while it's worked out). */
    checks: Record<string, TrackCheck | "checking" | undefined>;
    /** Audio files in media/ (for adding or replacing without dragging). */
    media: string[];
    edit: (label: string, fn: (d: Doc) => void) => void;
    onadd: (file: File | string) => void;
    onreplace: (id: string, file: File | string) => void;
    onremove: (id: string) => void;
    onrefreshmedia: () => void;
  } = $props();

  const mixId = $derived((doc.song.tracks.find((t) => t.mix) ?? doc.song.tracks[0])?.id);
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  /** What's wrong with a stem, in words, or "" when it lines up with the mix. */
  function warning(c: TrackCheck | "checking" | undefined, mix: boolean): string {
    if (!c || c === "checking" || mix) return "";
    const out: string[] = [];
    if (c.offset === null) out.push("couldn't tell whether it lines up with the mix (too little in common, or it's a whole bar out): listen to check");
    if (c.offset !== null && Math.abs(c.offset) >= 0.02)
      out.push(`starts ${Math.abs(c.offset).toFixed(2)} s ${c.offset > 0 ? "late" : "early"} against the mix: bounce it from the same start as the mix`);
    const d = c.seconds - c.mixSeconds;
    if (Math.abs(d) >= 0.1) out.push(`${Math.abs(d).toFixed(1)} s ${d < 0 ? "shorter" : "longer"} than the mix`);
    return out.join("; ");
  }
  // Warnings you've checked and dismissed (OK), by project, file and what was found: a new bounce is checked again
  const okKey = (file: string, c: TrackCheck) => `vizier.trackOk|${project}|${file}|${c.seconds.toFixed(2)}|${c.offset}`;
  let oks = $state<Record<string, boolean>>({});
  const isOk = (file: string, c: TrackCheck | "checking" | undefined) => {
    if (!c || c === "checking") return false;
    const k = okKey(file, c);
    if (k in oks) return oks[k]!;
    try { return localStorage.getItem(k) === "1"; } catch { return false; }
  };
  function dismiss(file: string, c: TrackCheck) {
    const k = okKey(file, c);
    oks[k] = true;
    try { localStorage.setItem(k, "1"); } catch { /* not available */ }
  }
  let dropOn = $state<string | null>(null);
  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
  function dropReplace(e: DragEvent, id: string) {
    e.preventDefault(); e.stopPropagation(); dropOn = null;
    const f = e.dataTransfer?.files[0];
    if (f) onreplace(id, f);
  }
  function pick(e: Event, fn: (file: string) => void) {
    const sel = e.currentTarget as HTMLSelectElement;
    const v = sel.value; sel.value = ""; sel.blur();
    if (v) fn(v);
  }
</script>

<div class="tracks">
  {#each doc.song.tracks as t, i (t.id)}
    {@const c = checks[t.file]}
    {@const warn = warning(c, t.id === mixId)}
    <div class="track" class:drop={dropOn === t.id} data-track={t.id}
      ondragover={(e) => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); dropOn = t.id; } }}
      ondragleave={() => { if (dropOn === t.id) dropOn = null; }}
      ondrop={(e) => dropReplace(e, t.id)} role="group" aria-label="Track {t.name}">
      <div class="row">
        <input class="name" type="text" value={t.name} aria-label="Track name"
          onkeydown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
          onchange={(e) => edit("rename track", (d) => renameTrack(d, t.id, (e.currentTarget as HTMLInputElement).value))} />
        {#if t.id === mixId}<em class="mix" title="The full song: what's played, and what the length and grid come from">mix</em>{/if}
        <button title="Move up" disabled={i === 0} onclick={() => edit("move track", (d) => moveTrack(d, t.id, -1))}>↑</button>
        <button title="Move down" disabled={i === doc.song.tracks.length - 1} onclick={() => edit("move track", (d) => moveTrack(d, t.id, 1))}>↓</button>
        <button class="rm" title={t.id === mixId ? "The mix can't be removed (replace its audio instead)" : "Remove the track (layers listening to it switch to the mix)"} disabled={t.id === mixId} onclick={() => onremove(t.id)}>✕</button>
      </div>
      <div class="meta">
        <span class="file" title={t.file}>{t.file.startsWith("media/.incoming/") ? `${trackNameFor(t.file)} (new, saved with the project)` : t.file.replace(/^media\//, "")}</span>
        {#if c === "checking"}<span class="dim">· checking…</span>{:else if c}<span class="dim">· {fmtTime(c.seconds)}</span>{/if}
        <select class="replace" onchange={(e) => pick(e, (f) => onreplace(t.id, f))} onfocus={onrefreshmedia} aria-label="Replace the audio of {t.name}"
          title="Replace its audio with a file from media/ (or drop a new bounce on this row)">
          <option value="">Replace…</option>
          {#each media.filter((m) => m !== t.file) as m}<option value={m}>{m.replace(/^media\//, "")}</option>{/each}
        </select>
      </div>
      {#if warn && c && c !== "checking" && !isOk(t.file, c)}
        <div class="warn" role="alert"><span>⚠ {warn}</span>
          <button title="It's fine: hide this warning (it comes back if the track gets a new file)" onclick={() => dismiss(t.file, c)}>OK</button></div>
      {/if}
    </div>
  {/each}
  <div class="add">
    <span class="hint">Drop audio files anywhere to add tracks; drop on a track to replace its audio.</span>
    <select onchange={(e) => pick(e, (f) => onadd(f))} onfocus={onrefreshmedia} aria-label="Add a track from media/">
      <option value="">+ Add from media/…</option>
      {#each media.filter((m) => !doc.song.tracks.some((t) => t.file === m)) as m}<option value={m}>{m.replace(/^media\//, "")}</option>{/each}
    </select>
  </div>
</div>

<style>
  .track { padding: 4px 6px; margin-bottom: 3px; background: var(--bg2); border: 1px solid var(--line); border-radius: 3px; }
  .track.drop { border-color: var(--accent); background: var(--bg3); }
  .row { display: flex; align-items: center; gap: 4px; }
  .name { flex: 1; min-width: 0; font-weight: 500; }
  .mix { font-size: 11px; color: var(--dim); }
  .meta { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--dim); margin-top: 2px; }
  .file { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .replace { margin-left: auto; font-size: 11px; max-width: 110px; }
  .warn { display: flex; align-items: flex-start; gap: 6px; font-size: 11px; color: var(--danger); margin-top: 3px; }
  .warn span { flex: 1; }
  .warn button { font-size: 11px; padding: 0 6px; }
  .add { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
  .hint { font-size: 11px; color: var(--dim); }
</style>
