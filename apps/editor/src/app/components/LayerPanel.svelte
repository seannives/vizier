<script lang="ts">
  import { GENERATORS, EFFECTS, type Span, type ParamSpec, type BlendMode, type LayoutFamily, type Transform } from "../../../../../packages/core/src/index.ts";
  import ParamControl from "./ParamControl.svelte";
  import ModRow from "./ModRow.svelte";
  import { featureAt } from "../lib/features.ts";
  import type { FeatureTrack } from "../../../../../packages/features/src/index.ts";
  import {
    layerOf, isInherited, splitLayerAt, patchLayer, setParam, setGenerator, setSpans, addEffect, removeEffect, moveEffect, setEffectParam,
    PANEL_LAYER_PARAMS, effectList, generatorList, placement, setLayout, hasOwnLayout,
    layerOrigin, isChanged, resetSetting, resetLayer, baseLayer, type Setting,
    modsOf, modOrigin, addMod, setMod, removeMod, resetMod,
  } from "../lib/edits.ts";
  import type { Doc } from "../lib/session.ts";

  /** The selected layer's settings: what draws it, its track, parameters, effects and when it's on. */
  let { doc, video, layerId, tracks, playheadBar, startBar = 1, automated, shownLanes = new Set<string>(), edit, seal, onselect, family = "landscape", onautomate,
    time = 0, features = null }: {
    /** The playhead (seconds) and the tracks' features, for the modulation meters. */
    time?: number; features?: Record<string, FeatureTrack> | null;
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
    /** Lanes shown in the timeline (A is highlighted for those). */
    shownLanes?: Set<string>;
    /** Start or show an automation lane for a target ("<layer>.<param>" or "<layer>.<effect>.<param>"). */
    onautomate?: (target: string, value: number) => void;
    /** The open video's layout family (its format's shape). */
    family?: LayoutFamily;
  } = $props();

  const layer = $derived(layerOf(doc, video, layerId));
  const gen = $derived(layer ? GENERATORS[layer.generator] : undefined);
  const inherited = $derived(isInherited(doc, video, layerId));
  const origin = $derived(layerOrigin(doc, video, layerId));
  const base = $derived(baseLayer(doc, video, layerId));
  const ch = (st: Setting) => isChanged(doc, video, layerId, st);
  const reset = (st: Setting, what: string) => edit(`reset ${what} to base`, (d) => resetSetting(d, video, layerId, st));
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
  // ---- layout (this format's shape) ----
  const place = $derived(layer ? placement(layer, family) : null);
  const ownLayout = $derived(layer ? hasOwnLayout(layer, family) : true);
  const borrowed = $derived(layer && !ownLayout ? (["landscape", "portrait", "feed"] as const).find((f) => layer.layout[f]) : null);
  function setPlace(patch: Partial<Transform>) {
    if (!place) return;
    const t = { ...place, ...patch };
    edit("layout", (d) => setLayout(d, video, layerId, family, t));
  }
  const pct = (n: number) => String(Math.round(n * 1000) / 10);
  const fromPct = (e: Event) => { const v = Number((e.currentTarget as HTMLInputElement).value); return Number.isFinite(v) ? v / 100 : undefined; };
  // ---- audio modulation: rows under a parameter, opened with M ----
  let openMods = $state(new Set<string>());
  const mixId = $derived(tracks.find((t) => t.mix)?.id ?? tracks[0]?.id ?? "mix");
  const modsFor = (target: string) => modsOf(doc, video, target);
  /** M: open rows close; closed ones open (adding a modulation first if there's none). */
  function modulate(target: string, spec: ParamSpec) {
    const n = new Set(openMods);
    if (n.has(target)) { n.delete(target); openMods = n; return; }
    if (!modsFor(target).length) addModFor(target, spec);
    n.add(target); openMods = n;
  }
  /** ✕ on a modulation; removing the last one closes the rows. */
  function removeModFor(target: string, source: string) {
    const last = modsFor(target).length <= 1; // (decided before: the panel sees the edit only once it re-renders)
    edit("remove modulation", (d) => removeMod(d, video, target, source));
    if (last) { const n = new Set(openMods); n.delete(target); openMods = n; }
  }
  /** A new modulation: the layer's own track, its smoothed loudness, a quarter of the parameter's range. */
  function addModFor(target: string, spec: ParamSpec) {
    const used = new Set(modsFor(target).map((m) => m.source));
    const track = layer?.track ?? mixId;
    const source = [`${track}.env`, ...tracks.map((t) => `${t.id}.env`)].find((x) => !used.has(x));
    if (!source) return;
    const amount = Math.round((spec.max - spec.min) * 0.25 * 1000) / 1000;
    edit("add modulation", (d) => { addMod(d, video, { target, source, amount }); });
  }
  const levelOf = (source: string) => { const [t, f] = source.split(".") as [string, string]; return featureAt(features, t, f, time); };
  const removeSpan = (i: number) => edit("remove on-span", (d) => setSpans(d, video, layerId, spans.filter((_, j) => j !== i)));
</script>

{#snippet modRows(target: string, spec: ParamSpec)}
  {#if openMods.has(target)}
    {#each modsFor(target) as m (m.source)}
      <ModRow mod={m} {spec} {tracks} level={levelOf(m.source)} origin={modOrigin(doc, video, m)}
        onchange={(next, final) => { edit("modulation", (d) => setMod(d, video, target, m.source, next), next.source === m.source ? `mod:${target}<-${m.source}` : undefined); if (final) seal(); }}
        onremove={() => removeModFor(target, m.source)}
        onreset={() => edit("modulation: back to the base's", (d) => resetMod(d, video, target, m.source))} />
    {/each}
    <button class="addmod" onclick={() => addModFor(target, spec)} title="Another track or feature also moves it (they add up)">+ another</button>
  {/if}
{/snippet}

{#if layer && gen}
<div class="panel">
  <div class="title">
    <span class="name">{layer.name ?? layer.id}</span>
    {#if inherited}<span class="inh" title="This layer comes from the base video; changes here are saved in this video only">{origin === "changed" ? "changed here" : "from base"}</span>{/if}
  </div>
  {#if origin === "changed"}
    <div class="spanbtns"><button onclick={() => edit("reset layer to base", (d) => resetLayer(d, video, layerId))} title="Drop every change this video makes to the layer">Reset layer to base</button></div>
  {/if}

  <label class="field"><span>Draws</span>
    <select value={layer.generator} onchange={changeGenerator} aria-label="Generator">
      {#each generatorList() as g}<option value={g.id}>{g.label}</option>{/each}
    </select>
  </label>
  <div class="field"><span>Track{#if ch({ field: "track" })}<button class="rs" title="Back to the base's track" onclick={(e) => { e.preventDefault(); reset({ field: "track" }, "track"); }}>↺</button>{/if}</span>
    <select value={layer.track ?? ""} aria-label="Track" onchange={(e) => { const t = e.currentTarget.value; e.currentTarget.blur(); edit("track", (d) => patchLayer(d, video, layerId, { track: t || undefined })); }}>
      <option value="">{tracks.find((t) => t.mix)?.name ?? "Mix"} (mix)</option>
      {#each tracks.filter((t) => !t.mix) as t}<option value={t.id}>{t.name}</option>{/each}
    </select>
  </div>
  <div class="field"><span>Blend{#if ch({ field: "blend" })}<button class="rs" title="Back to the base's blend" onclick={(e) => { e.preventDefault(); reset({ field: "blend" }, "blend"); }}>↺</button>{/if}</span>
    <select value={layer.blend ?? "normal"} aria-label="Blend" onchange={(e) => { const b = e.currentTarget.value as BlendMode; e.currentTarget.blur(); edit("blend", (d) => patchLayer(d, video, layerId, { blend: b })); }}>
      {#each BLENDS as b}<option value={b}>{b}</option>{/each}
    </select>
  </div>
  {#if gen.kind === "canvas2d" && gen.usesText}
    <div class="field col"><span>Text{#if ch({ field: "text" })}<button class="rs" title="Back to the base's text: {base?.text ?? ""}" onclick={(e) => { e.preventDefault(); reset({ field: "text" }, "text"); }}>↺</button>{/if}</span>
      <textarea rows="2" value={layer.text ?? ""} aria-label="Text" onkeydown={(e) => e.stopPropagation()}
        oninput={(e) => { const t = e.currentTarget.value; edit("text", (d) => patchLayer(d, video, layerId, { text: t }), `${layerId}.text`); }}
        onchange={seal}></textarea>
    </div>
  {/if}

  <h4>Layout <span class="fam">{family}</span>{#if ch({ layout: family })}<button class="rs" title="Back to the base's {family} layout" onclick={() => reset({ layout: family }, "layout")}>↺</button>{/if}</h4>
  {#if place}
    <div class="lay mono">
      <label>x <input type="text" value={pct(place.x)} aria-label="X (% of width)" onkeydown={(e) => e.stopPropagation()} onchange={(e) => { const v = fromPct(e); if (v !== undefined) setPlace({ x: v }); }} />%</label>
      <label>y <input type="text" value={pct(place.y)} aria-label="Y (% of height)" onkeydown={(e) => e.stopPropagation()} onchange={(e) => { const v = fromPct(e); if (v !== undefined) setPlace({ y: v }); }} />%</label>
      <label>w <input type="text" value={pct(place.w)} aria-label="Width (% of width)" onkeydown={(e) => e.stopPropagation()} onchange={(e) => { const v = fromPct(e); if (v !== undefined && v > 0) setPlace({ w: v }); }} />%</label>
      <label>h <input type="text" value={pct(place.h)} aria-label="Height (% of height)" onkeydown={(e) => e.stopPropagation()} onchange={(e) => { const v = fromPct(e); if (v !== undefined && v > 0) setPlace({ h: v }); }} />%</label>
      <label class="rot">rotation <input type="text" value={String(Math.round((place.rotation ?? 0) * 10) / 10)} aria-label="Rotation (degrees)" onkeydown={(e) => e.stopPropagation()} onchange={(e) => { const v = Number(e.currentTarget.value); if (Number.isFinite(v)) setPlace({ rotation: v }); }} />°</label>
    </div>
    {#if borrowed}<p class="note">Uses the {borrowed} layout. Changing it here gives this layer its own {family} layout.</p>{/if}
    <div class="spanbtns">
      <button onclick={() => setPlace({ x: 0.5, y: 0.5, w: 1, h: 1, rotation: 0 })}>Fill frame</button>
      <button onclick={() => setPlace({ x: 0.5, y: 0.5 })}>Centre</button>
    </div>
  {/if}

  <h4>On{#if ch({ field: "spans" })}<button class="rs" title="Back to when the base has it on" onclick={() => reset({ field: "spans" }, "on-spans")}>↺</button>{/if}</h4>
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
    <ParamControl spec={s} value={valueOf(s)} automated={automated.has(`${layerId}.${s.name}`)} laneShown={shownLanes.has(`${layerId}.${s.name}`)} onchange={(v, f) => param(s, v, f)}
      changed={ch({ param: s.name }) || (s.name === "opacity" && ch({ field: "opacity" }))} baseValue={base?.params?.[s.name] ?? (s.name === "opacity" ? base?.opacity : undefined)}
      onautomate={onautomate ? () => onautomate(`${layerId}.${s.name}`, valueOf(s)) : undefined}
      onreset={() => edit(`reset ${s.label.toLowerCase()} to base`, (d) => { resetSetting(d, video, layerId, { param: s.name }); if (s.name === "opacity") resetSetting(d, video, layerId, { field: "opacity" }); })}
      modulated={modsFor(`${layerId}.${s.name}`).length > 0} modsOpen={openMods.has(`${layerId}.${s.name}`)} onmodulate={() => modulate(`${layerId}.${s.name}`, s)} />
    {@render modRows(`${layerId}.${s.name}`, s)}
  {/each}

  <h4>Effects{#if ch({ field: "effects" })}<button class="rs" title="Back to the base's effect chain" onclick={() => reset({ field: "effects" }, "effects")}>↺</button>{/if}</h4>
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
        <ParamControl spec={s} value={e.params?.[s.name] ?? s.default} automated={automated.has(`${layerId}.${e.id ?? e.type}.${s.name}`)} laneShown={shownLanes.has(`${layerId}.${e.id ?? e.type}.${s.name}`)} onchange={(v, f) => effectParam(i, s, v, f)}
          onautomate={onautomate ? () => onautomate(`${layerId}.${e.id ?? e.type}.${s.name}`, e.params?.[s.name] ?? s.default) : undefined}
          modulated={modsFor(`${layerId}.${e.id ?? e.type}.${s.name}`).length > 0} modsOpen={openMods.has(`${layerId}.${e.id ?? e.type}.${s.name}`)}
          onmodulate={() => modulate(`${layerId}.${e.id ?? e.type}.${s.name}`, s)} />
        {@render modRows(`${layerId}.${e.id ?? e.type}.${s.name}`, s)}
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
  .rs { padding: 0 4px; font-size: 11px; line-height: 14px; margin-left: 5px; text-transform: none; letter-spacing: 0; }
  .field > span { display: flex; align-items: center; }
  .fam { text-transform: none; letter-spacing: 0; color: var(--faint); margin-left: 4px; }
  .lay { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 10px; font-size: 11px; color: var(--dim); }
  .lay label { display: flex; align-items: center; gap: 4px; }
  .lay input { width: 100%; min-width: 0; font-size: 11px; padding: 0 3px; text-align: right; }
  .lay .rot { grid-column: span 2; }
  .note { font-size: 11px; color: var(--faint); margin: 4px 0; }
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
  .addmod { margin: 0 0 8px 10px; font-size: 10px; padding: 0 6px; color: var(--dim); }
</style>
