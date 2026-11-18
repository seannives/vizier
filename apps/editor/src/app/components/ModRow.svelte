<script lang="ts">
  import type { Modulation, ParamSpec } from "../../../../../packages/core/src/index.ts";
  import { FEATURES, CURVES, contribution } from "../lib/features.ts";

  /** One modulation of a parameter: which track's feature drives it, by how much, with what curve; a live meter
   *  shows the feature's level now and what it adds to the parameter. */
  let { mod, spec, tracks, level, origin = "own", onchange, onremove, onreset }: {
    mod: Modulation; spec: ParamSpec; tracks: { id: string; name: string; mix?: boolean }[];
    /** The feature's value (0–1) at the playhead. */
    level: number;
    origin?: "own" | "base" | "changed";
    onchange: (m: Modulation, final: boolean) => void;
    onremove: () => void; onreset?: () => void;
  } = $props();

  const [track, feature] = $derived(mod.source.split(".") as [string, string]);
  const range = $derived(spec.max - spec.min || 1);
  const isInt = $derived(spec.type === "int" || spec.type === "toggle");
  const add = $derived(contribution(mod, level));
  const fmt = (n: number) => (Math.abs(n) >= 10 || isInt ? String(Math.round(n)) : String(Math.round(n * 100) / 100));
  const set = (patch: Partial<Modulation>, final = true) => onchange({ ...mod, ...patch }, final);
  function typed(e: Event) {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(v)) set({ amount: v }); else (e.currentTarget as HTMLInputElement).value = fmt(mod.amount);
  }
</script>

<div class="mod" data-mod={mod.source}>
  <div class="r1">
    <select value={track} aria-label="Modulation track" title="The track whose sound drives it"
      onchange={(e) => { set({ source: `${e.currentTarget.value}.${feature}` }); e.currentTarget.blur(); }}>
      {#each tracks as t}<option value={t.id}>{t.name}</option>{/each}
    </select>
    <select value={feature} aria-label="Modulation feature" title={FEATURES.find((f) => f.id === feature)?.hint ?? ""}
      onchange={(e) => { set({ source: `${track}.${e.currentTarget.value}` }); e.currentTarget.blur(); }}>
      {#each FEATURES as f}<option value={f.id} title={f.hint}>{f.label}</option>{/each}
    </select>
    {#if origin === "base"}<em class="tag" title="From the base video">base</em>{:else if origin === "changed"}<em class="tag ch" title="Changed in this video">changed</em>{/if}
    {#if origin === "changed" && onreset}<button title="Back to the base video's modulation" onclick={onreset}>↺</button>{/if}
    <button title="Remove this modulation" onclick={onremove} aria-label="Remove modulation">✕</button>
  </div>
  <div class="r2">
    <span class="lbl">by</span>
    <input type="range" min={-range} max={range} step={range / 200} value={Math.max(-range, Math.min(range, mod.amount))} aria-label="Modulation amount"
      title="How far it can move the value: at full level the parameter moves by this much (negative: down)"
      oninput={(e) => set({ amount: Number(e.currentTarget.value) }, false)} onchange={(e) => set({ amount: Number(e.currentTarget.value) })}
      ondblclick={() => set({ amount: 0 })} />
    <input class="num mono" type="text" value={fmt(mod.amount)} aria-label="Modulation amount (number)" onkeydown={(e) => e.stopPropagation()} onchange={typed} />
    <select class="curve" value={mod.curve ?? "linear"} aria-label="Modulation curve" title={CURVES.find((c) => c.id === (mod.curve ?? "linear"))?.hint}
      onchange={(e) => { set({ curve: e.currentTarget.value as Modulation["curve"] }); e.currentTarget.blur(); }}>
      {#each CURVES as c}<option value={c.id} title={c.hint}>{c.label}</option>{/each}
    </select>
  </div>
  <div class="meter" title="Now: {FEATURES.find((f) => f.id === feature)?.label ?? feature} at {Math.round(level * 100)}%, adding {add >= 0 ? "+" : ""}{fmt(add)} to {spec.label}">
    <div class="bar"><div class="fill" style:width="{Math.min(100, Math.max(0, level * 100))}%" data-level={level.toFixed(3)}></div></div>
    <span class="adds mono">{add >= 0 ? "+" : ""}{fmt(add)}</span>
  </div>
</div>

<style>
  .mod { margin: 0 0 6px 10px; padding: 4px 6px; border-left: 2px solid var(--accent-dim); background: var(--bg2); border-radius: 0 3px 3px 0; font-size: 11px; }
  .r1, .r2, .meter { display: flex; align-items: center; gap: 4px; }
  .r2, .meter { margin-top: 3px; }
  .r1 select { min-width: 0; flex: 1 1 0; font-size: 11px; padding: 0 2px; }
  .r1 button { font-size: 10px; padding: 0 4px; line-height: 15px; }
  .lbl { color: var(--dim); }
  input[type=range] { flex: 1; min-width: 0; }
  .num { width: 46px; text-align: right; font-size: 11px; padding: 0 3px; }
  .curve { font-size: 11px; padding: 0 2px; width: 62px; }
  .bar { flex: 1; height: 4px; background: var(--bg0); border-radius: 2px; overflow: hidden; }
  .fill { height: 100%; background: var(--accent); }
  .adds { width: 46px; text-align: right; color: var(--accent); }
  .tag { font-style: normal; font-size: 9px; color: var(--faint); border: 1px dashed var(--line2); border-radius: 2px; padding: 0 2px; }
  .tag.ch { color: var(--accent); border-style: solid; }
</style>
