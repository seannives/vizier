<script lang="ts">
  import type { ParamSpec } from "../../../../../packages/core/src/index.ts";
  /** One parameter: a slider and a number to type into. Double-click resets it to its default.
   *  `onchange(v, final)`: final is false while dragging, true when let go (or typed, or reset). */
  let { spec, value, automated = false, laneShown = false, changed = false, baseValue, onreset, onchange, onautomate }: {
    spec: ParamSpec; value: number; automated?: boolean; onchange: (v: number, final: boolean) => void;
    /** In a video built on another: this video changes the value (↺ goes back to the base's `baseValue`). */
    changed?: boolean; baseValue?: number; onreset?: () => void;
    /** Its automation lane is shown in the timeline (A is highlighted). */
    laneShown?: boolean;
    /** A: start an automation lane for this parameter, or show / hide it. */
    onautomate?: () => void;
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
    <span class="label" class:changed ondblclick={() => onchange(spec.default, true)} role="presentation">{spec.label}{#if automated}<em class="auto" title="An automation lane sets this while playing; the slider sets it only where no lane does">- automated</em>{/if}</span>
    {#if onautomate}<button class="auto-btn" class:on={laneShown} title={laneShown ? "Hide its automation lane" : automated ? "Show its automation lane" : "Automate: start a lane at the playhead, with this value"} onclick={onautomate} aria-label="Automate {spec.label}">A</button>{/if}
    {#if changed && onreset}<button class="rs" title="Back to the base video's value ({baseValue === undefined ? "default" : Math.round(baseValue * 100) / 100})" onclick={onreset} aria-label="Reset {spec.label} to base">↺</button>{/if}
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
</div>

<style>
  .param { margin: 0 0 6px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .label { font-size: 12px; color: var(--text); cursor: default; }
  .auto { color: var(--accent); font-style: normal; margin-left: 5px; }
  .label.changed::before { content: "•"; color: var(--accent); margin-right: 3px; }
  .label { flex: 1; }
  .rs { padding: 0 4px; font-size: 11px; line-height: 14px; }
  .auto-btn { padding: 0 4px; font-size: 10px; line-height: 14px; color: var(--dim); }
  .auto-btn.on { color: #111; }
  .num { width: 64px; text-align: right; font-size: 11px; padding: 1px 4px; }
  input[type=range] { width: 100%; margin: 2px 0 0; height: 14px; }
</style>
