<script lang="ts">
  import { GENERATORS, type LayerDef } from "../../../../../packages/core/src/index.ts";
  import { addLayer, removeLayer, moveLayer, duplicateLayer, renameLayer, generatorList } from "../lib/edits.ts";
  import type { Doc } from "../lib/session.ts";

  /** The video's layers, front first. Click to select; double-click a name to rename. */
  let { layers, video, selected, defaultTrack, trackName, edit, onselect }: {
    layers: LayerDef[]; video: string; selected: string | null; defaultTrack?: string;
    trackName: (id: string | undefined) => string;
    edit: (label: string, fn: (d: Doc) => void) => void;
    onselect: (id: string | null) => void;
  } = $props();

  let renaming = $state<string | null>(null);
  function add(e: Event) {
    const sel = e.currentTarget as HTMLSelectElement;
    const gen = sel.value;
    sel.value = "";
    sel.blur();
    if (!gen) return;
    let id = "";
    edit(`add ${GENERATORS[gen]?.label ?? gen}`, (d) => { id = addLayer(d, video, gen, defaultTrack); });
    if (id) onselect(id);
  }
  function commitName(id: string, e: Event) {
    const name = (e.currentTarget as HTMLInputElement).value.trim();
    renaming = null;
    if (name) edit("rename layer", (d) => renameLayer(d, video, id, name));
  }
</script>

<div class="list">
  {#each layers as l, i (l.id)}
    <div class="layer" class:sel={selected === l.id} onclick={() => onselect(l.id)} onkeydown={(e) => { if (e.key === "Enter") onselect(l.id); }} role="button" tabindex="-1" data-layer={l.id}>
      <div class="main">
        {#if renaming === l.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input class="rename" type="text" value={l.name ?? l.id} autofocus
            onkeydown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); if (e.key === "Escape") renaming = null; }}
            onblur={(e) => commitName(l.id, e)} onclick={(e) => e.stopPropagation()} />
        {:else}
          <div class="lname" ondblclick={() => (renaming = l.id)} role="presentation" title="Double-click to rename">{l.name ?? l.id}</div>
        {/if}
        <div class="lmeta">{GENERATORS[l.generator]?.label ?? l.generator} · {trackName(l.track)}{l.spans?.length ? " · part of the song" : ""}</div>
      </div>
      <div class="btns">
        <button title="Move in front" disabled={i === 0} onclick={(e) => { e.stopPropagation(); edit("move layer", (d) => moveLayer(d, video, l.id, 1)); }}>↑</button>
        <button title="Move behind" disabled={i === layers.length - 1} onclick={(e) => { e.stopPropagation(); edit("move layer", (d) => moveLayer(d, video, l.id, -1)); }}>↓</button>
        <button title="Duplicate" onclick={(e) => { e.stopPropagation(); let id = ""; edit("duplicate layer", (d) => { id = duplicateLayer(d, video, l.id); }); if (id) onselect(id); }}>⧉</button>
        <button title="Remove" class="rm" onclick={(e) => { e.stopPropagation(); edit(`remove ${l.name ?? l.id}`, (d) => removeLayer(d, video, l.id)); if (selected === l.id) onselect(null); }}>✕</button>
      </div>
    </div>
  {/each}
  <select class="add" onchange={add} aria-label="Add a layer">
    <option value="">+ Add layer…</option>
    {#each generatorList() as g}<option value={g.id}>{g.label}</option>{/each}
  </select>
</div>

<style>
  .layer { display: flex; align-items: center; gap: 4px; padding: 4px 6px; margin-bottom: 3px; background: var(--bg2);
    border: 1px solid var(--line); border-radius: 3px; cursor: default; }
  .layer.sel { border-color: var(--accent); background: var(--bg3); }
  .main { flex: 1; min-width: 0; }
  .lname { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lmeta { color: var(--dim); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rename { width: 100%; }
  .btns { display: flex; gap: 2px; opacity: 0; }
  .layer:hover .btns, .layer.sel .btns { opacity: 1; }
  .btns button { padding: 0 5px; font-size: 11px; line-height: 18px; }
  .btns .rm:hover { border-color: var(--danger); color: var(--danger); }
  .add { width: 100%; margin-top: 2px; color: var(--dim); }
</style>
