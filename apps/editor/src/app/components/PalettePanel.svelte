<script lang="ts">
  import { PALETTE_SLOTS } from "../../../../../packages/core/src/index.ts";
  import type { Doc } from "../lib/session.ts";
  import { paletteOf, paletteOrigin, resetPaletteSlot } from "../lib/edits.ts";

  /**
   * The palette: five colour slots that layers follow (changing one changes every layer that follows it). The
   * song's palette is shared by every video; a video can set a slot for itself.
   */
  let { doc, video, automated, shownLanes, edit, onpick, onautomate }: {
    doc: Doc; video: string;
    /** Colour targets with a lane ("palette.<slot>"). */
    automated: Set<string>;
    shownLanes: Set<string>;
    edit: (label: string, fn: (d: Doc) => void) => void;
    /** Open the picker for a slot, next to the swatch. */
    onpick: (slot: string, at: { x: number; y: number }) => void;
    /** A: start a colour lane for the slot (or show / hide it). */
    onautomate: (target: string, hex: string) => void;
  } = $props();

  const pal = $derived(paletteOf(doc, video));
  const hasBase = $derived(!!doc.videos[video]?.base);
</script>

<div class="palette">
  {#each PALETTE_SLOTS as s (s.id)}
    {@const origin = paletteOrigin(doc, video, s.id)}
    {@const target = `palette.${s.id}`}
    <div class="slot" data-slot={s.id}>
      <button class="sw" style:background={pal[s.id]} aria-label="{s.label} colour"
        title="{s.label}: {pal[s.id]?.toUpperCase()}. Click to change it"
        onclick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onpick(s.id, { x: r.left, y: r.bottom }); }}></button>
      <span class="label">{s.label}{#if automated.has(target)}<em class="auto" title="A colour lane sets it while playing">- automated</em>{/if}</span>
      {#if origin === "video"}<span class="tag changed" title="Set in this video only">this video</span>
        <button class="rs" title="Back to the {hasBase ? "base's" : "song's"} {s.label.toLowerCase()}" onclick={() => edit(`${s.label.toLowerCase()}: as the ${hasBase ? "base" : "song"}`, (d) => resetPaletteSlot(d, video, s.id))}>↺</button>
      {:else if origin === "base"}<span class="tag" title="Set by the base video">base</span>{/if}
      <span class="hex mono">{pal[s.id]?.toUpperCase()}</span>
      <button class="auto-btn" class:on={shownLanes.has(target)} aria-label="Automate {s.label}"
        title={shownLanes.has(target) ? "Hide its colour lane" : automated.has(target) ? "Show its colour lane" : "Automate: start a colour lane at the playhead, with this colour"}
        onclick={() => onautomate(target, pal[s.id]!)}>A</button>
    </div>
  {/each}
  <p class="hint">The song's palette, shared by every video unless a video sets a colour for itself (in the picker).</p>
</div>

<style>
  .slot { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
  .sw { width: 26px; height: 18px; padding: 0; border: 1px solid #fff3; border-radius: 3px; }
  .label { flex: 1; }
  .hex { color: var(--dim); font-size: 11px; }
  .auto { font-style: normal; color: var(--accent); font-size: 11px; margin-left: 4px; font-weight: 600; }
  .tag { font-size: 10px; color: var(--dim); border: 1px dashed var(--line2); border-radius: 2px; padding: 0 4px; }
  .tag.changed { color: var(--accent); border-style: solid; border-color: var(--accent-dim); }
  .rs { padding: 0 5px; font-size: 11px; }
  .auto-btn { padding: 0 5px; font-size: 11px; font-weight: 600; }
  .hint { color: var(--faint); font-size: 11px; margin: 6px 0 4px; }
</style>
