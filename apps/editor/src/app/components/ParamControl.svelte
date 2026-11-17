<script lang="ts">
  import type { ParamSpec } from "../../../../../packages/core/src/index.ts";
  /** One parameter: a slider and a number to type into. Double-click resets it to its default.
   *  `onchange(v, final)`: final is false while dragging, true when let go (or typed, or reset). */
  let { spec, value, automated = false, onchange }: {
    spec: ParamSpec; value: number; automated?: boolean; onchange: (v: number, final: boolean) => void;
  } = $props();

  const isInt = $derived(spec.type === "int" || spec.type === "toggle");
  const step = $derived(isInt ? 1 : (spec.max - spec.min) / 200);
  const shown = $derived(isInt ? String(Math.round(value)) : String(Math.round(value * 100) / 100));
  const clamp = (v: number) => Math.min(spec.max, Math.max(spec.min, v));
  function typed(e: Event) {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(v)) onchange(isInt ? Math.round(v) : v, true); // typed values may go past the slider's range
    else (e.currentTarget as HTMLInputElement).value = shown;
  }
</script>

<div class="param" title={spec.description ?? ""}>
  <div class="row">
    <span class="label" class:auto={automated} ondblclick={() => onchange(spec.default, true)} role="presentation">{spec.label}</span>
    {#if spec.type === "toggle"}
      <input type="checkbox" checked={value >= 0.5} onchange={(e) => onchange(e.currentTarget.checked ? 1 : 0, true)} aria-label={spec.label} />
    {:else}
      <input class="num mono" type="text" value={shown} onchange={typed} onkeydown={(e) => e.stopPropagation()} aria-label={spec.label} />
    {/if}
  </div>
  {#if spec.type !== "toggle"}
    <input type="range" min={spec.min} max={spec.max} {step} value={clamp(value)} aria-label="{spec.label} slider"
      oninput={(e) => onchange(Number(e.currentTarget.value), false)}
      onchange={(e) => onchange(Number(e.currentTarget.value), true)}
      ondblclick={() => onchange(spec.default, true)} />
  {/if}
  {#if automated}<div class="note">automated: the lane sets it while playing</div>{/if}
</div>

<style>
  .param { margin: 0 0 6px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .label { font-size: 12px; color: var(--text); cursor: default; }
  .label.auto { color: var(--accent); }
  .num { width: 64px; text-align: right; font-size: 11px; padding: 1px 4px; }
  input[type=range] { width: 100%; margin: 2px 0 0; height: 14px; }
  .note { font-size: 10px; color: var(--faint); }
</style>
