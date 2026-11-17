<script lang="ts">
  import { GENERATORS, EFFECTS, type Span, type ParamSpec, type BlendMode } from "../../../../../packages/core/src/index.ts";
  import ParamControl from "./ParamControl.svelte";
  import {
    layerOf, isInherited, splitLayerAt, patchLayer, setParam, setGenerator, setSpans, addEffect, removeEffect, moveEffect, setEffectParam,
    PANEL_LAYER_PARAMS, effectList, generatorList,
  } from "../lib/edits.ts";
  import type { Doc } from "../lib/session.ts";

  /** The selected layer's settings: what draws it, its track, parameters, effects and when it's on. */
  let { doc, video, layerId, tracks, playheadBar, startBar = 1, automated, edit, seal, onselect }: {
    doc: Doc; video: string; layerId: string; tracks: { id: string; name: string; mix?: boolean }[];
    /** The playhead's position in bars (for "split at playhead"), or null without a tempo. */
    playheadBar: number | null;
    /** The bar at the song's first moment. */
    startBar?: number;
    /** Targets that have an automation lane ("<layer>.<param>"). */
    automated: Set<string>;
    edit: (label: string, fn: (d: Doc) => void, merge?: string) => void;
    seal: () => void;
    onselect: (id: string | null) => void;
  } = $props();

  const layer = $derived(layerOf(doc, video, layerId));
  const gen = $derived(layer ? GENERATORS[layer.generator] : undefined);
  const inherited = $derived(isInherited(doc, video, layerId));
  const BLENDS: BlendMode[] = ["normal", "add", "screen", "multiply"];

  const valueOf = (s: ParamSpec) => layer?.params?.[s.name] ?? (s.name === "opacity" ? layer?.opacity : undefined) ?? s.default;
  function param(s: ParamSpec, v: number, final: boolean) {
    const id = layerId;
    edit(`${s.label.toLowerCase()}`, (d) => setParam(d, video, id, s.name, v), `${id}.${s.name}`);
    if (final) seal();
  }
  function effectParam(i: number, s: ParamSpec, v: number, final: boolean) {
    const id = layerId;
    edit(`${s.label.toLowerCase()}`, (d) => setEffectParam(d, video, id, i, s.name, v), `${id}.fx${i}.${s.name}`);
    if (final) seal();
  }
  function changeGenerator(e: Event) {
    const g = (e.currentTarget as HTMLSelectElement).value;
    (e.currentTarget as HTMLSelectElement).blur();
    let id = layerId;
    edit(`generator: ${GENERATORS[g]?.label ?? g}`, (d) => { id = setGenerator(d, video, layerId, g); });
    if (id !== layerId) onselect(id);
  }

  // ---- when it's on ----
  const spans = $derived<Span[]>(layer?.spans ?? []);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const fmt = (n: number | undefined) => (n === undefined ? "" : String(round(n)));
  function setSpan(i: number, patch: Partial<Span>) {
    const next = spans.map((s, j) => (j === i ? { ...s, ...patch } : s)).map((s) => {
      const c: Span = { ...s };
      for (const k of ["to", "fadeIn", "fadeOut"] as const) if (c[k] === undefined || Number.isNaN(c[k])) delete c[k];
      return c;
    });
    edit("change when the layer is on", (d) => setSpans(d, video, layerId, next));
  }
  const num = (e: Event) => { const v = (e.currentTarget as HTMLInputElement).value.trim(); return v === "" ? undefined : Number(v); };
  function splitAtPlayhead() {
    if (playheadBar === null) return;
    const at = playheadBar;
    edit("split at playhead", (d) => { splitLayerAt(d, video, layerId, at, startBar); });
  }
  function onFromPlayhead() {
    if (playheadBar === null) return;
    edit("on from playhead", (d) => setSpans(d, video, layerId, [...spans, { from: round(playheadBar!) }]));
  }
  const removeSpan = (i: number) => edit("remove on-span", (d) => setSpans(d, video, layerId, spans.filter((_, j) => j !== i)));
</script>

{#if layer && gen}
<div class="panel">
  <div class="title">
    <span class="name">{layer.name ?? layer.id}</span>
    {#if inherited}<span class="inh" title="This layer comes from the base video; changes here are saved in this video only">from base</span>{/if}
  </div>

  <label class="field"><span>Draws</span>
    <select value={layer.generator} onchange={changeGenerator} aria-label="Generator">
      {#each generatorList() as g}<option value={g.id}>{g.label}</option>{/each}
    </select>
  </label>
  <label class="field"><span>Track</span>
    <select value={layer.track ?? ""} aria-label="Track" onchange={(e) => { const t = e.currentTarget.value; e.currentTarget.blur(); edit("track", (d) => patchLayer(d, video, layerId, { track: t || undefined })); }}>
      <option value="">{tracks.find((t) => t.mix)?.name ?? "Mix"} (mix)</option>
      {#each tracks.filter((t) => !t.mix) as t}<option value={t.id}>{t.name}</option>{/each}
    </select>
  </label>
  <label class="field"><span>Blend</span>
    <select value={layer.blend ?? "normal"} aria-label="Blend" onchange={(e) => { const b = e.currentTarget.value as BlendMode; e.currentTarget.blur(); edit("blend", (d) => patchLayer(d, video, layerId, { blend: b })); }}>
      {#each BLENDS as b}<option value={b}>{b}</option>{/each}
    </select>
  </label>
  {#if gen.kind === "canvas2d" && gen.usesText}
    <label class="field col"><span>Text</span>
      <textarea rows="2" value={layer.text ?? ""} aria-label="Text" onkeydown={(e) => e.stopPropagation()}
        oninput={(e) => { const t = e.currentTarget.value; edit("text", (d) => patchLayer(d, video, layerId, { text: t }), `${layerId}.text`); }}
        onchange={seal}></textarea>
    </label>
  {/if}

  <h4>On</h4>
  {#if !spans.length}
    <div class="whole">Whole song</div>
  {:else}
    {#each spans as s, i}
      <div class="span mono">
        <div class="sr">
          <span>bars</span>
          <input type="text" value={fmt(s.from)} title="Bar it comes on" onkeydown={(e) => e.stopPropagation()} onchange={(e) => { const v = num(e); if (v !== undefined) setSpan(i, { from: v }); }} aria-label="On from bar" />
          <span>–</span>
          <input type="text" value={fmt(s.to)} placeholder="end" title="Bar it goes off (empty: the end)" onkeydown={(e) => e.stopPropagation()} onchange={(e) => setSpan(i, { to: num(e) })} aria-label="Off at bar" />
          <button class="x" title="Remove" onclick={() => removeSpan(i)}>✕</button>
        </div>
        <div class="sr">
          <span>fades</span>
          <input type="text" value={fmt(s.fadeIn)} placeholder="0" title="Fade in, in beats" onkeydown={(e) => e.stopPropagation()} onchange={(e) => setSpan(i, { fadeIn: num(e) })} aria-label="Fade in (beats)" />
          <span>/</span>
          <input type="text" value={fmt(s.fadeOut)} placeholder="0" title="Fade out, in beats" onkeydown={(e) => e.stopPropagation()} onchange={(e) => setSpan(i, { fadeOut: num(e) })} aria-label="Fade out (beats)" />
          <span class="unit">beats</span>
        </div>
      </div>
    {/each}
  {/if}
  <div class="spanbtns">
    <button onclick={splitAtPlayhead} disabled={playheadBar === null} title="Split at the playhead (⌘E)">Split at playhead</button>
    <button onclick={onFromPlayhead} disabled={playheadBar === null}>On from playhead</button>
    {#if spans.length}<button onclick={() => edit("on for the whole song", (d) => setSpans(d, video, layerId, null))}>Whole song</button>{/if}
  </div>

  <h4>Parameters</h4>
  {#each [...PANEL_LAYER_PARAMS, ...gen.params] as s (s.name)}
    <ParamControl spec={s} value={valueOf(s)} automated={automated.has(`${layerId}.${s.name}`)} onchange={(v, f) => param(s, v, f)} />
  {/each}

  <h4>Effects</h4>
  {#each layer.effects ?? [] as e, i (e.id ?? e.type)}
    {@const def = EFFECTS[e.type]}
    <div class="fx">
      <div class="fxhead">
        <span>{def?.label ?? e.type}{e.id && e.id !== e.type ? ` (${e.id})` : ""}</span>
        <span class="fxbtns">
          <button disabled={i === 0} title="Earlier in the chain" onclick={() => edit("move effect", (d) => moveEffect(d, video, layerId, i, -1))}>↑</button>
          <button disabled={i === (layer.effects?.length ?? 0) - 1} title="Later in the chain" onclick={() => edit("move effect", (d) => moveEffect(d, video, layerId, i, 1))}>↓</button>
          <button title="Remove" onclick={() => edit(`remove ${def?.label ?? e.type}`, (d) => removeEffect(d, video, layerId, i))}>✕</button>
        </span>
      </div>
      {#each def?.params ?? [] as s (s.name)}
        <ParamControl spec={s} value={e.params?.[s.name] ?? s.default} automated={automated.has(`${layerId}.${e.id ?? e.type}.${s.name}`)} onchange={(v, f) => effectParam(i, s, v, f)} />
      {/each}
    </div>
  {/each}
  <select class="add" aria-label="Add an effect" onchange={(e) => { const t = e.currentTarget.value; e.currentTarget.value = ""; e.currentTarget.blur(); if (t) edit(`add ${EFFECTS[t]?.label ?? t}`, (d) => addEffect(d, video, layerId, t)); }}>
    <option value="">+ Add effect…</option>
    {#each effectList() as fx}<option value={fx.id}>{fx.label}</option>{/each}
  </select>
</div>
{/if}

<style>
  .panel { padding-top: 4px; }
  .title { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .name { font-weight: 600; }
  .inh { font-size: 10px; color: var(--dim); border: 1px dashed var(--line2); border-radius: 2px; padding: 0 4px; }
  .field { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 5px; font-size: 12px; }
  .field > span { color: var(--dim); }
  .field select { flex: 0 1 170px; min-width: 0; }
  .field.col { flex-direction: column; align-items: stretch; }
  textarea { resize: vertical; font-family: 'Special Elite', var(--ui); }
  h4 { margin: 12px 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--dim); font-weight: 500; border-top: 1px solid var(--line); padding-top: 8px; }
  .whole { color: var(--dim); font-size: 12px; margin-bottom: 4px; }
  .span { font-size: 11px; color: var(--dim); padding: 3px 0; border-bottom: 1px solid var(--line); }
  .sr { display: grid; grid-template-columns: 38px 1fr 10px 1fr 34px; gap: 4px; align-items: center; margin: 2px 0; }
  .span input { width: 100%; min-width: 0; font-size: 11px; padding: 0 3px; }
  .span .x { padding: 0 5px; font-size: 11px; line-height: 16px; justify-self: end; }
  .unit { font-size: 10px; }
  .spanbtns { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 2px; }
  .spanbtns button { font-size: 11px; padding: 2px 6px; }
  .fx { background: var(--bg2); border: 1px solid var(--line); border-radius: 3px; padding: 5px 7px; margin-bottom: 5px; }
  .fxhead { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; font-weight: 500; }
  .fxbtns button { padding: 0 5px; font-size: 11px; line-height: 16px; }
  .add { width: 100%; color: var(--dim); }
</style>
