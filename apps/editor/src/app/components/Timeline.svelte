<script lang="ts">
  import { barToSeconds, secondsToBar, barLabel, type Grid } from "../../../../../packages/core/src/index.ts";
  import { xOf, tOf, snapTime, type View } from "../lib/timeline.ts";
  import type { Waveform } from "../lib/api.ts";

  export interface TrackRow { id: string; name: string; mix?: boolean; wave: Waveform | null }
  /** A layer under its track: when it's on, in seconds (`null`: the whole song). */
  export interface SpanS { from: number; to: number; fadeIn: number; fadeOut: number }
  export interface LayerRow { id: string; name: string; track: string; spans: SpanS[] | null }

  let { grid, sections, tracks, layers = [], selectedLayer = null, selectedSpan = null, duration, time, range, rangeInherited, follow,
    marker = 0, snap = true, onseek, onrange, onselectlayer = () => {}, onspans = () => {} }: {
    grid?: Grid; sections: { t: number; name: string }[]; tracks: TrackRow[]; duration: number; time: number;
    layers?: LayerRow[]; selectedLayer?: string | null; selectedSpan?: number | null;
    onselectlayer?: (id: string | null, span: number | null) => void;
    /** A span was created, moved or resized (seconds; `to` may be Infinity). */
    onspans?: (id: string, spans: SpanS[]) => void;
    range: { from: number; to: number } | null; rangeInherited: boolean; follow: boolean; marker?: number; snap?: boolean;
    onseek: (t: number) => void; onrange: (r: { from: number; to: number } | null) => void;
  } = $props();

  const H_RULER = 28, H_SECT = 20, H_TRACK = 46, H_LAYER = 18;
  // rows below the sections: each track, then the layers it drives
  type Row = { kind: "track"; i: number; y: number; h: number } | { kind: "layer"; layer: LayerRow; y: number; h: number };
  const rows = $derived.by(() => {
    const out: Row[] = [];
    let y = H_RULER + H_SECT;
    tracks.forEach((t, i) => {
      out.push({ kind: "track", i, y, h: H_TRACK }); y += H_TRACK;
      for (const l of layers.filter((l) => l.track === t.id)) { out.push({ kind: "layer", layer: l, y, h: H_LAYER }); y += H_LAYER; }
    });
    return out;
  });
  const height = $derived(rows.length ? rows[rows.length - 1]!.y + rows[rows.length - 1]!.h : H_RULER + H_SECT);
  const rowAt = (y: number) => rows.find((r) => y >= r.y && y < r.y + r.h);

  let canvas: HTMLCanvasElement;
  let wrap: HTMLDivElement;
  let width = $state(800);
  let view = $state<View>({ start: 0, pxPerSec: 6 });
  let fitted = false;
  let dragRange = $state<{ from: number; to: number } | null>(null);

  const shownRange = $derived(dragRange ?? range);

  // ---- zoom & scroll ----
  const clampView = (v: View): View => {
    const span = width / v.pxPerSec;
    const pxPerSec = Math.min(2000, Math.max(width / Math.max(1, duration * 1.1), v.pxPerSec));
    const start = Math.min(Math.max(-span * 0.05, v.start), Math.max(0, duration - span * 0.5));
    return { start, pxPerSec };
  };
  export function fit() { if (duration > 0) view = clampView({ start: 0, pxPerSec: (width - 8) / duration }); }
  export function zoomAt(factor: number, x = width / 2) {
    const t = tOf(x, view);
    const pxPerSec = view.pxPerSec * factor;
    view = clampView({ pxPerSec, start: t - x / pxPerSec });
  }
  export function zoomIn() { zoomAt(1.5, Math.max(0, Math.min(width, xOf(time, view)))); }
  export function zoomOut() { zoomAt(1 / 1.5, Math.max(0, Math.min(width, xOf(time, view)))); }
  /** For tests and tools: where a moment is drawn, in page coordinates. */
  export function pageX(t: number) { return canvas.getBoundingClientRect().left + xOf(t, view); }
  export function rulerY() { return canvas.getBoundingClientRect().top + H_RULER / 2; }
  /** For tests: the middle of a layer's row, in page coordinates. */
  export function layerY(id: string) { const r = rows.find((r) => r.kind === "layer" && r.layer.id === id); return r ? canvas.getBoundingClientRect().top + r.y + r.h / 2 : NaN; }
  export function laneY() { return canvas.getBoundingClientRect().top + H_RULER + H_SECT + H_TRACK / 2; }
  export function zoomLevel() { return view.pxPerSec; }

  $effect(() => { if (!fitted && duration > 0 && width > 100) { fitted = true; fit(); } });

  function onwheel(e: WheelEvent) {
    e.preventDefault();
    // ⌘ + two-finger swipe up zooms in, as in Ableton on a Mac (with natural scrolling a swipe up has deltaY > 0).
    // Pinch (reported as Ctrl + wheel) and Ctrl + mouse wheel elsewhere: spreading / wheel up zooms in.
    if (e.metaKey) zoomAt(Math.exp(e.deltaY * 0.01), e.offsetX);
    else if (e.ctrlKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.offsetX);
    else view = clampView({ ...view, start: view.start + (e.shiftKey ? e.deltaY : e.deltaX || e.deltaY) / view.pxPerSec });
  }

  // keep the playhead in view while playing
  $effect(() => {
    if (!follow) return;
    const x = xOf(time, view);
    if (x > width - 24 || x < 0) view = clampView({ ...view, start: time - (width * 0.08) / view.pxPerSec });
  });

  // ---- size ----
  $effect(() => {
    const ro = new ResizeObserver(() => { width = Math.max(100, wrap.clientWidth); });
    ro.observe(wrap);
    return () => ro.disconnect();
  });

  // ---- waveform columns, recomputed when the view changes ----
  function columns(w: Waveform, v: View, cols: number): Int8Array {
    const out = new Int8Array(cols * 2);
    for (let c = 0; c < cols; c++) {
      const a = Math.floor(tOf(c, v) * w.rate), b = Math.max(a + 1, Math.floor(tOf(c + 1, v) * w.rate));
      let lo = 0, hi = 0;
      for (let i = Math.max(0, a); i < Math.min(w.peaks.length / 2, b); i++) { const l = w.peaks[i * 2]!, h = w.peaks[i * 2 + 1]!; if (l < lo) lo = l; if (h > hi) hi = h; }
      out[c * 2] = lo; out[c * 2 + 1] = hi;
    }
    return out;
  }
  const cols = $derived(tracks.map((t) => (t.wave ? columns(t.wave, view, Math.ceil(width)) : null)));
  const peaks = $derived(tracks.map((t) => { if (!t.wave) return 127; let m = 1; for (const v of t.wave.peaks) m = Math.max(m, Math.abs(v)); return m; }));

  // ---- drawing ----
  const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  $effect(() => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const C = { bg0: css("--bg0"), bg1: css("--bg1"), bg2: css("--bg2"), line: css("--line"), line2: css("--line2"), text: css("--text"), dim: css("--dim"), faint: css("--faint"), accent: css("--accent") };
    const v = view, W = width, H = height;
    const t0 = v.start, t1 = tOf(W, v);
    ctx.fillStyle = C.bg1; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.bg2; ctx.fillRect(0, 0, W, H_RULER);
    // the song's extent
    ctx.fillStyle = C.bg0; ctx.fillRect(xOf(duration, v), 0, W, H); ctx.fillRect(0, 0, Math.max(0, xOf(0, v)), H);

    // grid: bars, beats, labels
    ctx.font = `11px ${css("--mono")}`; ctx.textBaseline = "middle";
    if (grid) {
      const b0 = Math.floor(secondsToBar(Math.max(0, t0), grid)) - 1, b1 = Math.ceil(secondsToBar(t1, grid)) + 1;
      const pxBar = (barToSeconds(b0 + 2, grid) - barToSeconds(b0 + 1, grid)) * v.pxPerSec;
      const every = [1, 2, 4, 8, 16, 32, 64].find((n) => n * pxBar >= 44) ?? 128;
      const bpb = grid.tempo[0]?.beatsPerBar ?? 4;
      for (let b = Math.max(0, b0); b <= b1; b++) {
        const x = Math.round(xOf(barToSeconds(b, grid), v)) + 0.5;
        if (x < -2 || x > W + 2) continue;
        const major = (b - 1) % every === 0;
        ctx.fillStyle = major ? C.line2 : C.line;
        if (major || pxBar > 10) ctx.fillRect(x, H_RULER, 1, H - H_RULER);
        if (pxBar / bpb >= 9) for (let q = 1; q < bpb; q++) {
          const xb = Math.round(xOf(barToSeconds(b + q / bpb, grid), v)) + 0.5;
          ctx.fillStyle = "#ffffff0d"; ctx.fillRect(xb, H_RULER + H_SECT, 1, H - H_RULER - H_SECT);
        }
        if (major && b >= 1) {
          ctx.fillStyle = C.dim; ctx.fillRect(x, H_RULER - 8, 1, 8);
          ctx.fillText(barLabel(b, grid).replace(/\.1$/, ""), x + 4, H_RULER - 9);
        }
      }
    }

    // range bracket (in the ruler) and the area outside it dimmed
    const r = shownRange;
    if (r) {
      const xa = xOf(r.from, v), xb = xOf(r.to, v);
      ctx.fillStyle = "#00000059";
      ctx.fillRect(0, H_RULER, Math.max(0, xa), H); ctx.fillRect(xb, H_RULER, W, H);
      ctx.fillStyle = rangeInherited && !dragRange ? "#f5a52422" : "#f5a52455";
      ctx.fillRect(xa, 2, xb - xa, 10);
      ctx.fillStyle = C.accent;
      ctx.fillRect(xa, 2, 2, 12); ctx.fillRect(xb - 2, 2, 2, 12);
    }

    // sections
    const ys = H_RULER;
    ctx.fillStyle = C.bg1; ctx.fillRect(0, ys, W, H_SECT);
    ctx.font = `500 11px ${css("--ui")}`;
    sections.forEach((s, i) => {
      const x = xOf(s.t, v), xe = xOf(sections[i + 1]?.t ?? duration, v);
      if (xe < 0 || x > W) return;
      ctx.fillStyle = i % 2 ? "#ffffff08" : "#ffffff12"; ctx.fillRect(x, ys + 2, xe - x - 1, H_SECT - 4);
      ctx.fillStyle = C.dim; ctx.fillRect(Math.round(x), ys, 1, H - ys);
      ctx.fillStyle = C.text;
      ctx.save(); ctx.beginPath(); ctx.rect(x, ys, Math.max(0, xe - x - 4), H_SECT); ctx.clip();
      ctx.fillText(s.name, Math.max(x, 0) + 5, ys + H_SECT / 2 + 1); ctx.restore();
    });

    // waveforms
    for (const row of rows) {
      if (row.kind !== "track") continue;
      const i = row.i, tr = tracks[i]!;
      // each track is scaled to its own loudest moment, so quiet stems are still readable
      const peak = peaks[i] || 127;
      const y = row.y, mid = y + H_TRACK / 2, amp = (H_TRACK - 8) / 2 / peak;
      ctx.fillStyle = C.line; ctx.fillRect(0, y, W, 1);
      const c = cols[i];
      if (!c) { ctx.fillStyle = C.faint; ctx.fillText("loading…", 8, mid); continue; }
      ctx.fillStyle = tr.mix ? "#c9c9c4" : "#8e8e88";
      for (let x = 0; x < W; x++) {
        const lo = c[x * 2]!, hi = c[x * 2 + 1]!;
        if (hi === 0 && lo === 0) continue;
        ctx.fillRect(x, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
      }
    }

    // layers: when each is on
    for (const row of rows) {
      if (row.kind !== "layer") continue;
      const l = row.layer, sel = l.id === selectedLayer;
      const spans = dragSpans && dragSpans.id === l.id ? dragSpans.spans : l.spans;
      ctx.fillStyle = sel ? "#ffffff0a" : "#00000033"; ctx.fillRect(0, row.y, W, row.h);
      ctx.fillStyle = C.line; ctx.fillRect(0, row.y, W, 1);
      const y0 = row.y + 3, h = row.h - 6;
      if (!spans) { // on for the whole song
        ctx.fillStyle = sel ? "#f5a52430" : "#ffffff14";
        ctx.fillRect(xOf(0, v), y0, xOf(duration, v) - xOf(0, v), h);
        continue;
      }
      spans.forEach((sp, j) => {
        const xa = xOf(sp.from, v), xb = xOf(Math.min(sp.to, duration), v);
        if (xb < 0 || xa > W) return;
        const on = sel && (selectedSpan === j || dragSpans?.id === l.id && dragSpans.index === j);
        ctx.fillStyle = on ? "#f5a524" : sel ? "#f5a524aa" : "#f5a52466";
        // fades as ramps: the block narrows to nothing at a faded edge
        const fi = Math.min(xb - xa, sp.fadeIn * v.pxPerSec), fo = Math.min(xb - xa, sp.fadeOut * v.pxPerSec);
        ctx.beginPath();
        ctx.moveTo(xa, y0 + h); ctx.lineTo(xa + fi, y0); ctx.lineTo(xb - fo, y0); ctx.lineTo(xb, y0 + h); ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#111"; ctx.fillRect(xa, y0, 1, h); ctx.fillRect(xb - 1, y0, 1, h);
      });
    }
  });

  // ---- mouse: seek, scrub, create / move / resize the range ----
  type Drag = { kind: "seek" | "edgeL" | "edgeR" | "move" | "maybe"; x0: number; t0: number; orig: { from: number; to: number } | null; moved: boolean };
  let drag: Drag | null = null;
  // snapping (clicks, scrubbing and range edges) follows the Snap setting; holding Shift does the opposite
  const snapT = (t: number, e: MouseEvent) => (grid && snap !== e.shiftKey ? snapTime(Math.min(Math.max(0, t), duration), grid) : Math.min(Math.max(0, t), duration));

  // ---- layer rows: select a layer or span; drag a span's edges or body; drag in empty space to make a span ----
  type SpanDrag = { id: string; index: number; kind: "L" | "R" | "move" | "new"; x0: number; t0: number; orig: SpanS[]; moved: boolean };
  let spanDrag: SpanDrag | null = null;
  let dragSpans = $state<{ id: string; index: number; spans: SpanS[] } | null>(null);
  function spanHit(l: LayerRow, x: number): { index: number; part: "L" | "R" | "move" } | null {
    const sp = l.spans ?? [];
    for (let j = 0; j < sp.length; j++) {
      const xa = xOf(sp[j]!.from, view), xb = xOf(Math.min(sp[j]!.to, duration), view);
      if (Math.abs(x - xa) < 5) return { index: j, part: "L" };
      if (Math.abs(x - xb) < 5) return { index: j, part: "R" };
    }
    for (let j = 0; j < sp.length; j++) if (x > xOf(sp[j]!.from, view) && x < xOf(Math.min(sp[j]!.to, duration), view)) return { index: j, part: "move" };
    return null;
  }
  function layerDown(e: PointerEvent, l: LayerRow) {
    const x = e.offsetX, t = tOf(x, view);
    const hit = spanHit(l, x);
    spanDrag = { id: l.id, index: hit?.index ?? -1, kind: hit?.part ?? "new", x0: x, t0: t, orig: l.spans ?? [], moved: false };
    onselectlayer(l.id, hit ? hit.index : null);
  }
  function layerMove(e: PointerEvent) {
    const d = spanDrag!;
    const x = e.offsetX, t = tOf(x, view);
    if (Math.abs(x - d.x0) > 3) d.moved = true;
    if (!d.moved) return;
    const min = 0.05;
    const sp = d.orig.map((s) => ({ ...s }));
    if (d.kind === "new") {
      const a = snapT(d.t0, e), b = snapT(t, e);
      const s: SpanS = { from: Math.min(a, b), to: Math.max(a, b, Math.min(a, b) + min), fadeIn: 0, fadeOut: 0 };
      dragSpans = { id: d.id, index: sp.length, spans: [...sp, s] };
      return;
    }
    const s = sp[d.index]!;
    if (d.kind === "L") s.from = Math.min(snapT(t, e), s.to - min);
    else if (d.kind === "R") s.to = Math.max(snapT(t, e), s.from + min);
    else { const from = snapT(s.from + (t - d.t0), e); s.to = s.to === Infinity ? Infinity : s.to + (from - s.from); s.from = from; }
    dragSpans = { id: d.id, index: d.index, spans: sp };
  }
  function layerUp(e: PointerEvent) {
    const d = spanDrag!; spanDrag = null;
    const ds = dragSpans; dragSpans = null;
    if (d.moved && ds) { onspans(d.id, ds.spans); if (d.kind === "new") onselectlayer(d.id, ds.index); return; }
    if (d.kind === "new") onseek(snapT(d.t0, e)); // a click in empty space moves the playhead too
  }

  function onpointerdown(e: PointerEvent) {
    canvas.setPointerCapture(e.pointerId);
    const x = e.offsetX, y = e.offsetY, t = tOf(x, view);
    const row = rowAt(y);
    if (row?.kind === "layer") return layerDown(e, row.layer);
    const r = range;
    if (y < H_RULER) {
      if (r && Math.abs(x - xOf(r.from, view)) < 6) drag = { kind: "edgeL", x0: x, t0: t, orig: r, moved: false };
      else if (r && Math.abs(x - xOf(r.to, view)) < 6) drag = { kind: "edgeR", x0: x, t0: t, orig: r, moved: false };
      else drag = { kind: "maybe", x0: x, t0: t, orig: r && t > r.from && t < r.to ? r : null, moved: false };
    } else {
      drag = { kind: "seek", x0: x, t0: t, orig: null, moved: false };
      onseek(snapT(t, e));
    }
  }
  function onpointermove(e: PointerEvent) {
    const x = e.offsetX, t = tOf(x, view);
    if (spanDrag) return layerMove(e);
    if (!drag) {
      const r = range;
      const row = rowAt(e.offsetY);
      const edge = row?.kind === "layer" ? spanHit(row.layer, x) : null;
      canvas.style.cursor = (e.offsetY < H_RULER && r && (Math.abs(x - xOf(r.from, view)) < 6 || Math.abs(x - xOf(r.to, view)) < 6)) || (edge && edge.part !== "move") ? "ew-resize" : "default";
      return;
    }
    if (Math.abs(x - drag.x0) > 3) drag.moved = true;
    if (!drag.moved) return;
    if (drag.kind === "seek") return onseek(snapT(t, e));
    if (drag.kind === "maybe") drag.kind = drag.orig ? "move" : "edgeR", drag.orig ??= { from: snapT(drag.t0, e), to: snapT(drag.t0, e) };
    const o = drag.orig!;
    if (drag.kind === "edgeL") dragRange = { from: Math.min(snapT(t, e), o.to), to: o.to };
    else if (drag.kind === "edgeR") { const a = snapT(t, e); dragRange = { from: Math.min(o.from, a), to: Math.max(o.from, a) }; }
    else if (drag.kind === "move") { const len = o.to - o.from; const from = snapT(o.from + (t - drag.t0), e); dragRange = { from, to: Math.min(duration, from + len) }; }
  }
  function onpointerup(e: PointerEvent) {
    canvas.releasePointerCapture(e.pointerId);
    if (spanDrag) return layerUp(e);
    const d = drag; drag = null;
    if (!d) return;
    if (!d.moved && (d.kind === "maybe" || d.kind === "edgeL" || d.kind === "edgeR")) { onseek(snapT(d.t0, e)); return; }
    if (dragRange) { const r = dragRange; dragRange = null; if (r.to - r.from > 0.05) onrange(r); }
  }
</script>

<div class="timeline">
  <div class="heads">
    <div class="h ruler" style:height="{H_RULER}px">Bars</div>
    <div class="h" style:height="{H_SECT}px">Sections</div>
    {#each rows as r}
      {#if r.kind === "track"}
        {@const t = tracks[r.i]!}
        <div class="h track" style:height="{H_TRACK}px" title={t.id}><span class:mix={t.mix}>{t.name}</span>{#if t.mix}<em>mix</em>{/if}</div>
      {:else}
        <div class="h layer" class:sel={r.layer.id === selectedLayer} style:height="{H_LAYER}px" title={r.layer.name}
          onclick={() => onselectlayer(r.layer.id, null)} onkeydown={(e) => { if (e.key === "Enter") onselectlayer(r.layer.id, null); }} role="button" tabindex="-1">{r.layer.name}</div>
      {/if}
    {/each}
  </div>
  <div class="wrap" bind:this={wrap}>
    <canvas bind:this={canvas} style:height="{height}px" style:width="{width}px"
      {onwheel} {onpointerdown} {onpointermove} {onpointerup}></canvas>
    <!-- the playhead and start marker sit on their own layer, so playing moves them without redrawing the waveforms -->
    {#if Math.abs(marker - time) > 1e-3}
      <div class="marker" style:transform="translateX({xOf(marker, view)}px)"></div>
    {/if}
    <div class="playhead" style:height="{height}px" style:transform="translateX({xOf(time, view)}px)"></div>
  </div>
</div>

<style>
  .timeline { display: flex; height: 100%; overflow-y: auto; overflow-x: hidden; background: var(--bg1); border-top: 1px solid var(--line2); }
  .heads { flex: 0 0 132px; border-right: 1px solid var(--line2); background: var(--bg2); }
  .h { display: flex; align-items: center; gap: 6px; padding: 0 8px; border-bottom: 1px solid var(--line); color: var(--dim);
    font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
  .h.ruler { background: var(--bg2); }
  .h.track { text-transform: none; letter-spacing: 0; font-size: 12px; color: var(--text); }
  .h.track span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .h.layer { height: 18px; padding-left: 18px; font-size: 11px; text-transform: none; letter-spacing: 0; color: var(--dim); cursor: default;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; line-height: 17px; }
  .h.layer.sel { color: var(--accent); background: var(--bg3); }
  .h.track em { font-style: normal; font-size: 10px; color: var(--accent); border: 1px solid var(--accent-dim); border-radius: 2px; padding: 0 3px; }
  .wrap { flex: 1; min-width: 0; position: relative; overflow: hidden; }
  canvas { display: block; touch-action: none; }
  .playhead, .marker { position: absolute; left: 0; top: 0; pointer-events: none; will-change: transform; }
  .playhead { width: 1.5px; margin-left: -0.75px; background: var(--accent); }
  .playhead::before { content: ""; position: absolute; top: 0; left: -4.25px; border: 5px solid transparent; border-top: 7px solid var(--accent); border-bottom: 0; }
  .marker { top: 19px; left: -5px; width: 0; height: 0; border: 5px solid transparent; border-top: 7px solid var(--accent); border-bottom: 0; opacity: .7; }
</style>
