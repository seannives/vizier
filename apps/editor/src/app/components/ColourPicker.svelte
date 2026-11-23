<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { hexToOklch, oklchToHex } from "../../../../../packages/core/src/index.ts";

  /**
   * vizier's colour picker: the palette's swatches first (picking from the palette is the usual case), then a hex
   * field and three sliders in OKLCH (lightness, vividness, hue: they move the colour the way it looks), and an
   * eyedropper. Opens as a popover at a point; Esc or a click outside closes it.
   */
  let { value, slot = null, palette, allowSlots = false, at, title = "Colour", onchange, onclose, children }: {
    /** The colour shown now, #rrggbb. */
    value: string;
    /** The palette slot it follows (when it follows one). */
    slot?: string | null;
    palette: { id: string; label: string; hex: string }[];
    /** Swatches pick the slot itself (the colour follows the palette); otherwise they copy the slot's colour. */
    allowSlots?: boolean;
    /** Where to open (page coordinates of the swatch that opened it). */
    at: { x: number; y: number };
    title?: string;
    /** A new colour (#rrggbb) or a palette slot's id; `live` while a slider is being dragged (one undo step). */
    onchange: (v: string, live: boolean) => void;
    onclose: () => void;
    /** Extra controls under the sliders. */
    children?: Snippet;
  } = $props();

  // the sliders' own values: kept while dragging (a colour's hue is lost at grey, so it isn't read back from hex)
  let lch = $state<[number, number, number]>(hexToOklch("#808080"));
  let shown = "";
  $effect(() => { if (value.toLowerCase() !== shown) { lch = hexToOklch(value); shown = value.toLowerCase(); } });
  let hexText = $state("");
  $effect(() => { hexText = value.toUpperCase(); });

  const MAXC = 0.37;
  function slide(i: 0 | 1 | 2, x: number, live: boolean) {
    const next = [...lch] as [number, number, number];
    next[i] = x;
    lch = next;
    const hex = oklchToHex(next);
    shown = hex.toLowerCase();
    onchange(hex, live);
  }
  // slider backgrounds: what each slider does to this colour
  const stops = (f: (u: number) => [number, number, number]) => `linear-gradient(to right, ${Array.from({ length: 13 }, (_, i) => oklchToHex(f(i / 12))).join(", ")})`;
  const gradL = $derived(stops((u) => [u, lch[1], lch[2]]));
  const gradC = $derived(stops((u) => [lch[0], u * MAXC, lch[2]]));
  const gradH = $derived(stops((u) => [lch[0], Math.max(lch[1], 0.08), u * 360]));

  function typedHex() {
    const t = hexText.trim().replace(/^#?/, "#");
    const full = /^#[0-9a-f]{3}$/i.test(t) ? `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}` : t;
    if (/^#[0-9a-f]{6}$/i.test(full)) onchange(full.toLowerCase(), false);
    else hexText = value.toUpperCase();
  }
  async function eyedrop() {
    const ED = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (ED) { try { const r = await new ED().open(); onchange(r.sRGBHex.toLowerCase(), false); } catch { /* cancelled */ } return; }
    native?.click();
  }
  let native = $state<HTMLInputElement>();

  // place it on screen, next to where it was opened
  let box = $state<HTMLDivElement>();
  let pos = $state({ left: 0, top: 0 });
  onMount(() => {
    const w = box?.offsetWidth ?? 240, h = box?.offsetHeight ?? 300;
    pos = { left: Math.max(8, Math.min(at.x, window.innerWidth - w - 8)), top: Math.max(8, Math.min(at.y + 6, window.innerHeight - h - 8)) };
    const away = (e: PointerEvent) => { if (box && !box.contains(e.target as Node)) onclose(); };
    const keys = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onclose(); } };
    // (after the click that opened it)
    const t = setTimeout(() => document.addEventListener("pointerdown", away, true), 0);
    window.addEventListener("keydown", keys, true);
    return () => { clearTimeout(t); document.removeEventListener("pointerdown", away, true); window.removeEventListener("keydown", keys, true); };
  });
</script>

<div class="picker" bind:this={box} style:left="{pos.left}px" style:top="{pos.top}px" role="dialog" aria-label={title}>
  <div class="head"><span class="swatch big" style:background={value}></span><span class="title">{title}</span></div>
  <div class="slots" role="group" aria-label="Palette">
    {#each palette as p (p.id)}
      <button class="slot" class:sel={allowSlots && slot === p.id} style:background={p.hex} aria-label={p.label}
        title={allowSlots ? `Follow the palette's ${p.label} (${p.hex.toUpperCase()}): changes with it` : `${p.label}: ${p.hex.toUpperCase()}`}
        onclick={() => onchange(allowSlots ? p.id : p.hex.toLowerCase(), false)}></button>
    {/each}
  </div>
  {#if allowSlots}<div class="follows">{slot ? `Follows ${palette.find((p) => p.id === slot)?.label ?? slot}` : "Its own colour"}</div>{/if}
  <div class="row">
    <input class="hex mono" type="text" bind:value={hexText} aria-label="Hex colour" spellcheck="false"
      onkeydown={(e) => { e.stopPropagation(); if (e.key === "Enter") { typedHex(); (e.currentTarget as HTMLInputElement).blur(); } }} onblur={typedHex} />
    <button class="drop" title="Pick a colour from anywhere on the screen" onclick={eyedrop} aria-label="Eyedropper">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M11.5 1.5a2.1 2.1 0 0 1 3 3L12.8 6.2l.9.9-1.1 1.1-.9-.9-6 6H3.5v-2.2l6-6-.9-.9 1.1-1.1.9.9z" fill="currentColor" /></svg>
    </button>
    <input bind:this={native} class="native" type="color" value={value} onchange={(e) => onchange((e.currentTarget as HTMLInputElement).value, false)} tabindex="-1" aria-hidden="true" />
  </div>
  <label class="sl" title="Lightness: black to white, as it looks"><span>Light</span>
    <input type="range" min="0" max="1" step="0.001" value={lch[0]} style:background={gradL} aria-label="Lightness"
      oninput={(e) => slide(0, +(e.currentTarget as HTMLInputElement).value, true)} onchange={(e) => slide(0, +(e.currentTarget as HTMLInputElement).value, false)} /></label>
  <label class="sl" title="Vividness: grey to fully saturated"><span>Vivid</span>
    <input type="range" min="0" max={MAXC} step="0.001" value={lch[1]} style:background={gradC} aria-label="Vividness"
      oninput={(e) => slide(1, +(e.currentTarget as HTMLInputElement).value, true)} onchange={(e) => slide(1, +(e.currentTarget as HTMLInputElement).value, false)} /></label>
  <label class="sl" title="Hue: round the colour wheel"><span>Hue</span>
    <input type="range" min="0" max="360" step="0.5" value={lch[2]} style:background={gradH} aria-label="Hue"
      oninput={(e) => slide(2, +(e.currentTarget as HTMLInputElement).value, true)} onchange={(e) => slide(2, +(e.currentTarget as HTMLInputElement).value, false)} /></label>
  {#if children}<div class="extra">{@render children()}</div>{/if}
</div>

<style>
  .picker { position: fixed; z-index: 60; width: 236px; padding: 10px; background: var(--bg2); border: 1px solid var(--line2);
    border-radius: 6px; box-shadow: 0 8px 24px #000a; display: flex; flex-direction: column; gap: 7px; }
  .head { display: flex; align-items: center; gap: 8px; }
  .title { font-weight: 500; }
  .swatch.big { width: 22px; height: 22px; border-radius: 4px; border: 1px solid #fff3; }
  .slots { display: flex; gap: 6px; }
  .slot { width: 34px; height: 24px; padding: 0; border: 1px solid #fff3; border-radius: 4px; }
  .slot.sel { outline: 2px solid var(--accent); outline-offset: 1px; }
  .follows { font-size: 11px; color: var(--dim); margin-top: -3px; }
  .row { display: flex; gap: 6px; align-items: center; }
  .hex { flex: 1; text-transform: uppercase; }
  .drop { padding: 3px 7px; display: inline-flex; }
  .native { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }
  .sl { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--dim); }
  .sl span { width: 34px; }
  .sl input { flex: 1; height: 12px; border-radius: 3px; }
  .sl input::-webkit-slider-runnable-track { background: transparent; }
  .sl input::-webkit-slider-thumb { background: #fff; border: 1px solid #000; height: 14px; margin-top: -1px; }
  .extra:not(:has(*)) { display: none; }
  .extra { border-top: 1px solid var(--line); padding-top: 7px; font-size: 12px; display: flex; flex-direction: column; gap: 5px; }
</style>
