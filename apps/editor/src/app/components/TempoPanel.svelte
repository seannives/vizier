<script lang="ts">
  import type { Doc } from "../lib/session.ts";
  import { tempoSegments, setTempo, addTempoChange, moveTempoChange, removeTempoChange, setDownbeat } from "../lib/edits.ts";
  import { barToSeconds, secondsToBar, type Grid } from "../../../../../packages/core/src/index.ts";
  import { displayKeys } from "../lib/shortcuts.ts";

  export interface TempoGuess { bpm: number; downbeat: number; beatsPerBar: number; candidates: { bpm: number; score: number }[] }

  /**
   * The song's grid (shared by every video): where bar 1 starts, the tempo and beats per bar, and changes at later
   * bars, with the tempo worked out from the mix as a suggestion. Layers, lanes and ranges are in bars, so they move
   * with the grid.
   */
  let { doc, time, detected, clicking, edit, seal, onclick }: {
    doc: Doc;
    /** The playhead, in seconds. */
    time: number;
    /** What the mix suggests (null while it's worked out). */
    detected: TempoGuess | null;
    clicking: boolean;
    edit: (label: string, fn: (d: Doc) => void, merge?: string) => void;
    seal: () => void;
    onclick: () => void;
  } = $props();

  const grid = $derived(doc.song.grid as Grid);
  const segs = $derived(tempoSegments(doc));
  const downbeat = $derived(grid.downbeat ?? 0);
  const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);
  const playBar = $derived(secondsToBar(time, grid));
  /** The bar a change "at the playhead" goes at: the playhead's bar if it's on a bar line, else the next. */
  const changeBar = $derived(Math.max(2, Math.abs(playBar - Math.round(playBar)) < 0.02 ? Math.round(playBar) : Math.ceil(playBar)));
  /** Slide the grid so the bar line nearest the playhead lands on it. */
  function barLineToPlayhead() {
    const b = Math.round(playBar);
    const shift = time - barToSeconds(b, grid);
    if (downbeat + shift < 0) { nudgeMsg = "bar 1 would start before the audio does: pick a later bar line"; return; }
    edit(`bar ${b} at the playhead`, (d) => setDownbeat(d, downbeat + shift));
  }
  let nudgeMsg = $state("");
  const nudge = (ms: number) => { nudgeMsg = ""; edit("move the grid", (d) => setDownbeat(d, downbeat + ms / 1000), "downbeat"); };
  const fmt = (x: number) => String(Math.round(x * 1000) / 1000);
</script>

<div class="tempo">
  <div class="field">
    <span title="Where bar 1 starts in the mix, in seconds. Exports often start with a lead-in before the music">Bar 1 starts at</span>
    <input class="num" type="number" step="0.001" min="0" value={fmt(downbeat)} aria-label="Bar 1 starts at (seconds)"
      onkeydown={(e) => e.stopPropagation()} onchange={(e) => edit("where bar 1 starts", (d) => setDownbeat(d, num(e)))} /> s
    <button title="Grid 10 ms earlier (⇧: 1 ms)" onclick={(e) => nudge(e.shiftKey ? -1 : -10)} onpointerup={seal}>◂</button>
    <button title="Grid 10 ms later (⇧: 1 ms)" onclick={(e) => nudge(e.shiftKey ? 1 : 10)} onpointerup={seal}>▸</button>
  </div>
  <div class="field">
    <button onclick={barLineToPlayhead} title="Slide the grid so the bar line nearest the playhead is exactly at the playhead: put the playhead on a downbeat you can hear (or see in the waveform), then press this">Bar line to playhead</button>
    <button class:on={clicking} onclick={onclick} title="Click on every beat while playing, to check the grid by ear ({displayKeys("C")})">Click</button>
  </div>
  {#if nudgeMsg}<p class="warn">{nudgeMsg}</p>{/if}

  <table>
    <thead><tr><th>From bar</th><th>BPM</th><th title="Beats per bar">Beats</th><th></th></tr></thead>
    <tbody>
      {#each segs as s (s.bar)}
        <tr data-tempo-bar={s.bar}>
          <td>{#if s.bar === 1}1{:else}<input class="num bar" type="number" step="1" min="2" value={s.bar} aria-label="Change at bar"
              onkeydown={(e) => e.stopPropagation()} onchange={(e) => edit("move tempo change", (d) => moveTempoChange(d, s.bar, num(e)))} />{/if}</td>
          <td><input class="num" type="number" step="0.01" min="20" max="400" value={s.bpm} aria-label="BPM from bar {s.bar}"
              onkeydown={(e) => e.stopPropagation()} onchange={(e) => edit("tempo", (d) => setTempo(d, s.bar, { bpm: num(e) }))} /></td>
          <td><input class="num small" type="number" step="1" min="1" max="16" value={s.beatsPerBar ?? 4} aria-label="Beats per bar from bar {s.bar}"
              onkeydown={(e) => e.stopPropagation()} onchange={(e) => edit("beats per bar", (d) => setTempo(d, s.bar, { beatsPerBar: num(e) }))} /></td>
          <td>{#if s.bar !== 1}<button class="x" title="Remove this change" onclick={() => edit("remove tempo change", (d) => removeTempoChange(d, s.bar))}>✕</button>{/if}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  <button onclick={() => edit("add tempo change", (d) => { addTempoChange(d, changeBar); })} disabled={segs.some((s) => s.bar === changeBar)}
    title="A tempo or time-signature change from a bar on">+ Change at bar {changeBar}</button>

  <div class="detected">
    {#if !detected}<span class="dim">Working out the tempo from the mix…</span>
    {:else}
      <span class="dim" title="From the mix: a starting point to check by ear (half and double tempos are common mix-ups)">From the mix:</span>
      {#each detected.candidates.slice(0, 3) as c, i}
        <button class:best={i === 0} title="Use {c.bpm} BPM from bar 1" onclick={() => edit("tempo from the mix", (d) => setTempo(d, 1, { bpm: c.bpm }))} disabled={segs[0]?.bpm === c.bpm}>{c.bpm}</button>
      {/each}
      <button title="Bar 1 at {detected.downbeat} s, as worked out from the mix" onclick={() => edit("bar 1 from the mix", (d) => setDownbeat(d, detected!.downbeat))} disabled={Math.abs(downbeat - detected.downbeat) < 0.0005}>bar 1 at {detected.downbeat} s</button>
    {/if}
  </div>
  <p class="hint">⌥-drag in the bar ruler slides the grid. Layers, lanes and ranges are in bars, so they move with it.</p>
</div>

<style>
  .field { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
  .field span:first-child { flex: 1; }
  .num { width: 74px; }
  .num.small { width: 44px; }
  .num.bar { width: 56px; }
  table { border-collapse: collapse; margin: 6px 0 4px; }
  th { font-weight: 400; color: var(--dim); font-size: 11px; text-align: left; padding-right: 6px; }
  td { padding: 1px 6px 1px 0; }
  .detected { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 6px; font-size: 12px; }
  .detected .best { border-color: var(--accent); }
  .dim { color: var(--dim); }
  .hint { color: var(--faint); font-size: 11px; margin: 6px 0 4px; }
  .warn { color: var(--warn, #e0a040); font-size: 11px; margin: 2px 0; }
  .on { border-color: var(--accent); color: var(--accent); }
</style>
