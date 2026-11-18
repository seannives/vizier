<script lang="ts">
  import { PROFILES, videoFormat, resolveVideo } from "../../../../../packages/core/src/index.ts";
  import { setVideo, detachVideo } from "../lib/edits.ts";
  import type { Doc } from "../lib/session.ts";

  /** The open video's settings: name, format, what it builds on (Open base, Detach), and its range. */
  let { doc, video, rangeLabel, rangeTime, rangeInherited, edit, onopen }: {
    doc: Doc; video: string; rangeLabel: string; rangeTime: string; rangeInherited: boolean;
    edit: (label: string, fn: (d: Doc) => void) => void;
    onopen: (video: string) => void;
  } = $props();

  /** Formats a video can have (not the live window's). */
  const FORMATS = Object.values(PROFILES).filter((p) => !p.id.startsWith("live"));
  const own = $derived(doc.videos[video]!);
  const base = $derived(own.base ?? null);
  // (formats are inherited along the whole chain of bases, so read the combined videos, not just the files)
  const fmtOf = (name: string) => { try { return videoFormat(resolveVideo(name, (n) => doc.videos[n]!)); } catch { return undefined; } };
  const baseFormat = $derived(base && doc.videos[base] ? fmtOf(base) : undefined);
  const format = $derived(fmtOf(video) ?? "youtube");
  const formatChanged = $derived(!!base && !!videoFormat(own) && !!baseFormat && videoFormat(own) !== baseFormat);
  const rangeChanged = $derived(!!base && own.range !== undefined);
  const baseName = $derived(base ? doc.videos[base]?.name ?? base : null);
</script>

<div class="video">
  <label class="field"><span>Name</span>
    <input type="text" value={own.name ?? video} aria-label="Video name" onkeydown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); }}
      onchange={(e) => { const n = e.currentTarget.value.trim(); if (n) edit("rename video", (d) => setVideo(d, video, { name: n })); }} />
  </label>
  <div class="field"><span>Format{#if formatChanged}<button class="rs" title="Back to the base's format" onclick={(e) => { e.preventDefault(); edit("format: as the base", (d) => setVideo(d, video, { format: undefined })); }}>↺</button>{/if}</span>
    <select value={format} aria-label="Format" onchange={(e) => { const f = e.currentTarget.value; e.currentTarget.blur(); edit(`format: ${PROFILES[f]?.label ?? f}`, (d) => setVideo(d, video, { format: f })); }}>
      {#each FORMATS as p}<option value={p.id}>{p.label}</option>{/each}
    </select>
  </div>
  <div class="field"><span>Builds on</span>
    {#if base}
      <span class="base">
        <button class="link" title="Open the base video" onclick={() => onopen(base!)}>{baseName}</button>
        <button title="Copy everything it inherits into this video, so it no longer follows {baseName}" onclick={() => edit("detach from base", (d) => detachVideo(d, video))}>Detach</button>
      </span>
    {:else}
      <span class="none">nothing (stands alone)</span>
    {/if}
  </div>
  <div class="field top"><span>Range{#if rangeChanged}<button class="rs" title="Back to the base's range" onclick={() => edit("range: as the base", (d) => setVideo(d, video, { range: undefined }))}>↺</button>{/if}</span>
    <span class="range mono">
      <span>{rangeLabel}{#if rangeInherited}<em class="inh" title="from the base video">inherited</em>{/if}</span>
      <span class="dim">{rangeTime}</span>
    </span>
  </div>
</div>

<style>
  .video { margin-bottom: 6px; }
  .field { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 5px; font-size: 12px; }
  .field.top { align-items: flex-start; }
  .field > span:first-child { color: var(--dim); display: flex; align-items: center; flex: 0 0 auto; }
  .field input, .field select { flex: 0 1 170px; min-width: 0; }
  .base { display: flex; gap: 4px; align-items: center; min-width: 0; }
  .base button { font-size: 11px; padding: 1px 6px; }
  .link { background: none; border: none; color: var(--accent); text-decoration: underline; padding: 0; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .none { color: var(--faint); }
  .range { display: flex; flex-direction: column; align-items: flex-end; font-size: 12px; }
  .dim { color: var(--dim); }
  .inh { font: 10px var(--ui); color: var(--dim); border: 1px dashed var(--line2); border-radius: 2px; padding: 0 4px; margin-left: 6px; }
  .rs { padding: 0 4px; font-size: 11px; line-height: 14px; margin-left: 5px; }
</style>
