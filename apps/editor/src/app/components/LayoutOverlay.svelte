<script lang="ts">
  import type { LayerDef, LayoutFamily, Transform } from "../../../../../packages/core/src/index.ts";
  import { placement, frontToBack } from "../lib/edits.ts";
  import { contains, moved, resized, rotated, toScreen, type Frame, type Guide } from "../lib/layoutDrag.ts";

  /**
   * Over the preview: the selected layer's box, with handles to resize (corners and edges) and rotate (the knob on
   * top). Click a layer to select it (clicking again where layers overlap picks the next one down); drag to move.
   * Snaps to the frame's and safe area's edges and centres; ⇧ turns snapping off, ⌥ resizes about the centre.
   */
  let { layers, family, safe, selected, isOn, onselect, onlayout }: {
    layers: LayerDef[]; family: LayoutFamily; safe?: { x: number; y: number; w: number; h: number };
    selected: string | null;
    /** Whether a layer is on at the playhead (layers that are off can't be clicked). */
    isOn: (l: LayerDef) => boolean;
    onselect: (id: string | null) => void;
    onlayout: (id: string, t: Transform, final: boolean) => void;
  } = $props();

  let W = $state(0), H = $state(0);
  const frame = $derived<Frame>({ W, H, safe });
  const front = $derived(frontToBack(layers)); // (ties as the renderer draws them)
  const sel = $derived(layers.find((l) => l.id === selected) ?? null);
  let live = $state<Transform | null>(null); // while dragging: what's shown before the project catches up
  const t = $derived(live ?? (sel ? placement(sel, family) : null));
  let guides = $state<Guide[]>([]);

  type Drag = { kind: "move" | "resize" | "rotate"; id: string; sx: number; sy: number; p0: { x: number; y: number }; orig: Transform; moved: boolean; cycle: boolean };
  let drag: Drag | null = null;
  let svg: SVGSVGElement;
  const pt = (e: PointerEvent) => { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  function down(e: PointerEvent) {
    if (!W || !H) return;
    const p = pt(e);
    const el = e.target as Element;
    const handle = el.getAttribute?.("data-handle");
    if (handle && sel && t) {
      const [sx, sy] = handle === "rot" ? [0, 0] : handle.split(",").map(Number) as [number, number];
      drag = { kind: handle === "rot" ? "rotate" : "resize", id: sel.id, sx, sy, p0: p, orig: { ...t }, moved: false, cycle: false };
    } else {
      const hits = front.filter((l) => isOn(l) && contains(placement(l, family), frame, p));
      if (sel && hits.some((l) => l.id === sel.id)) drag = { kind: "move", id: sel.id, sx: 0, sy: 0, p0: p, orig: placement(sel, family), moved: false, cycle: hits.length > 1 };
      else if (hits[0]) { onselect(hits[0].id); drag = { kind: "move", id: hits[0].id, sx: 0, sy: 0, p0: p, orig: placement(hits[0], family), moved: false, cycle: false }; }
      else { onselect(null); return; }
    }
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function move(e: PointerEvent) {
    const d = drag;
    if (!d) return;
    const p = pt(e);
    if (!d.moved && Math.hypot(p.x - d.p0.x, p.y - d.p0.y) < 3) return;
    d.moved = true;
    let next: Transform;
    if (d.kind === "move") { const r = moved(d.orig, p.x - d.p0.x, p.y - d.p0.y, frame, e.shiftKey); next = r.t; guides = r.guides; }
    else if (d.kind === "resize") { const r = resized(d.orig, { sx: d.sx, sy: d.sy }, p, frame, { free: e.shiftKey, fromCentre: e.altKey }); next = r.t; guides = r.guides; }
    else { next = rotated(d.orig, d.p0, p, frame, e.shiftKey); guides = []; }
    live = next;
    onlayout(d.id, next, false);
  }
  function up(e: PointerEvent) {
    const d = drag;
    drag = null;
    svg.releasePointerCapture(e.pointerId);
    guides = [];
    if (d?.moved && live) onlayout(d.id, live, true);
    else if (d?.cycle) {
      // a click (no drag) on the selected layer where others overlap: select the next one down
      const p = pt(e);
      const hits = front.filter((l) => isOn(l) && contains(placement(l, family), frame, p));
      const i = hits.findIndex((l) => l.id === d.id);
      onselect(hits[(i + 1) % hits.length]!.id);
    }
    live = null;
  }
  const HANDLES = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]] as const;
  const cursorFor = (sx: number, sy: number, rot: number) => {
    // pick the resize cursor nearest the handle's on-screen direction
    const a = ((Math.atan2(sy, sx) * 180) / Math.PI - rot + 360) % 180;
    return ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][Math.round(a / 45) % 4];
  };
</script>

<div class="overlay" bind:clientWidth={W} bind:clientHeight={H}>
  <svg bind:this={svg} width={W} height={H} onpointerdown={down} onpointermove={move} onpointerup={up} role="presentation">
    {#each guides as g}
      {#if g.axis === "x"}<line class="guide" x1={g.at * W} x2={g.at * W} y1="0" y2={H} />
      {:else}<line class="guide" y1={g.at * H} y2={g.at * H} x1="0" x2={W} />{/if}
    {/each}
    {#if sel && t}
      {@const hw = (t.w * W) / 2}
      {@const hh = (t.h * H) / 2}
      {@const rot = t.rotation ?? 0}
      <!-- the rotate knob sits above the box, or just inside it when that would be off the preview -->
      {@const out = toScreen({ x: 0, y: -hh - 18 }, rot)}
      {@const kx = t.x * W + out.x}
      {@const ky = t.y * H + out.y}
      {@const knobY = kx < 6 || kx > W - 6 || ky < 6 || ky > H - 6 ? -hh + 18 : -hh - 18}
      <g transform="translate({t.x * W} {t.y * H}) rotate({-rot})" data-box={sel.id}>
        <rect class="box" x={-hw} y={-hh} width={hw * 2} height={hh * 2} />
        <line class="stem" x1="0" y1={-hh} x2="0" y2={knobY} />
        <circle class="knob" cx="0" cy={knobY} r="5" data-handle="rot"><title>Rotate (⇧: free)</title></circle>
        {#each HANDLES as [sx, sy]}
          <rect class="handle" x={sx * hw - 4} y={sy * hh - 4} width="8" height="8" data-handle="{sx},{sy}" style:cursor={cursorFor(sx, -sy, rot)} />
        {/each}
      </g>
    {/if}
  </svg>
</div>

<style>
  .overlay { position: absolute; inset: 0; }
  svg { display: block; overflow: visible; cursor: default; touch-action: none; }
  .box { fill: none; stroke: var(--accent); stroke-width: 1; vector-effect: non-scaling-stroke; cursor: move; }
  .handle { fill: var(--bg0); stroke: var(--accent); stroke-width: 1; }
  .stem { stroke: var(--accent); stroke-width: 1; }
  .knob { fill: var(--accent); cursor: grab; }
  .guide { stroke: #ff3b8a; stroke-width: 1; stroke-dasharray: 3 3; }
</style>
