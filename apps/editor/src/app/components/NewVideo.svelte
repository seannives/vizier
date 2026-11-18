<script lang="ts">
  import { untrack } from "svelte";
  import { PROFILES } from "../../../../../packages/core/src/index.ts";

  /** Make a new video: blank, building on the open one, or an independent copy of it. */
  let { currentName, currentFormat, how: initialHow = "base", oncreate, oncancel }: {
    currentName: string; currentFormat: string; how?: "blank" | "base" | "copy";
    oncreate: (o: { name: string; format: string; how: "blank" | "base" | "copy" }) => void;
    oncancel: () => void;
  } = $props();
  const FORMATS = Object.values(PROFILES).filter((p) => !p.id.startsWith("live"));
  // starting values, taken once when the dialog opens
  const start = untrack(() => ({ how: initialHow, name: initialHow === "copy" ? `${currentName} copy` : "", format: initialHow === "base" ? "reels" : currentFormat }));
  let how = $state(start.how);
  let name = $state(start.name);
  let format = $state(start.format);
  function submit(e: Event) { e.preventDefault(); if (name.trim()) oncreate({ name: name.trim(), format, how }); }
</script>

<div class="scrim" role="presentation" onclick={oncancel}>
  <div class="panel" onclick={(e) => e.stopPropagation()} onkeydown={(e) => { e.stopPropagation(); if (e.key === "Escape") oncancel(); }} role="dialog" aria-label="New video" tabindex="-1">
  <form onsubmit={submit}>
    <h2>New video</h2>
    <fieldset>
      <label><input type="radio" bind:group={how} value="base" /> Build on <b>{currentName}</b> <span class="hint">follows its changes; change anything here</span></label>
      <label><input type="radio" bind:group={how} value="copy" /> Copy of <b>{currentName}</b> <span class="hint">independent from now on</span></label>
      <label><input type="radio" bind:group={how} value="blank" /> Blank <span class="hint">no layers</span></label>
    </fieldset>
    <label class="field"><span>Name</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input type="text" bind:value={name} placeholder="e.g. Reel: the drop" autofocus aria-label="New video name" />
    </label>
    <label class="field"><span>Format</span>
      <select bind:value={format} aria-label="New video format">{#each FORMATS as p}<option value={p.id}>{p.label}</option>{/each}</select>
    </label>
    <div class="btns">
      <button type="button" onclick={oncancel}>Cancel</button>
      <button type="submit" class="on" disabled={!name.trim()}>Create</button>
    </div>
  </form>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; background: #000a; display: flex; align-items: center; justify-content: center; z-index: 10; }
  .panel { background: var(--bg2); border: 1px solid var(--line2); border-radius: 6px; padding: 16px 20px; width: 420px; }
  h2 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
  fieldset { border: none; padding: 0; margin: 0 0 12px; display: flex; flex-direction: column; gap: 6px; }
  fieldset label { font-size: 13px; }
  .hint { color: var(--faint); font-size: 11px; margin-left: 4px; }
  .field { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
  .field span { color: var(--dim); }
  .field input, .field select { flex: 0 1 260px; }
  .btns { display: flex; justify-content: flex-end; gap: 6px; margin-top: 12px; }
</style>
