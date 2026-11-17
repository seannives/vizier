<script lang="ts">
  import { untrack } from "svelte";
  import { Renderer } from "../../../../../packages/core/src/browser/renderer.ts";
  import { getProfile, type Project } from "../../../../../packages/core/src/index.ts";
  import { stats } from "../lib/stats.ts";
  import type { FeatureTrack } from "../../../../../packages/features/src/index.ts";

  let { project, profileId, features, time, scaleOverride = null, loopWraps = 0 }: {
    project: Project | null; profileId: string; features: Record<string, FeatureTrack> | null; time: number;
    scaleOverride?: number | null; loopWraps?: number;
  } = $props();
  // a loop wrapping is a jump back in time; let trails flow on through it rather than re-render a lead-in
  let seenWraps = 0;

  let host: HTMLDivElement;
  let renderer: Renderer | null = null;
  let error = $state<string | null>(null);
  const profile = $derived(getProfile(profileId));
  // preview at about half size: plenty for judging, and cheap
  const scale = $derived(scaleOverride ?? Math.min(1, 960 / Math.max(profile.width, profile.height)));

  // The renderer is built once per format, preview size and analysis; edits to the project are applied to it in
  // place (Renderer.update), so trails flow on while you change parameters.
  let shown = -1;
  let applied: Project | null = null;
  let redraw = $state(0);
  let rebuild = $state(0); // bumped when an edit arrives and there's no renderer (none yet, or the last build failed)
  $effect(() => {
    void rebuild;
    if (!features) return;
    const f = features, id = profileId, s = scale;
    const p = untrack(() => project);
    if (!p) return;
    let r: Renderer | null = null;
    try {
      r = new Renderer(p, id, f, "'Special Elite'", s);
      stats.counts.renderersBuilt++;
      r.prerollSeconds = 1; // seeking should feel instant; trails are close enough after a second
      r.canvas.className = "frame";
      host.querySelector("canvas")?.remove();
      host.prepend(r.canvas);
      renderer = r;
      applied = p;
      error = null;
      // untracked: this effect must rerun only when the format or analysis changes, not when the playhead moves
      shown = Math.floor(untrack(() => time) * r.profile.fps + 1e-6);
      r.renderFrame(shown);
    } catch (e) { error = (e as Error).message; }
    return () => { r?.dispose(); if (renderer === r) renderer = null; };
  });

  // an edit: apply it to the renderer and draw again
  $effect(() => {
    const p = project;
    untrack(() => {
      if (!p || p === applied) return;
      if (!renderer) { if (features) rebuild++; return; }
      try { renderer.update(p); applied = p; error = null; redraw++; } catch (e) { error = (e as Error).message; }
    });
  });

  // The preview shows whole frames at the video's frame rate, as the export will: a new frame only when the playhead
  // reaches it (30 a second for most formats), rather than one for every screen refresh (60 or 120 a second).
  // After an edit while paused, the frame is drawn again at once (trails just continue), then, once the edits pause,
  // once more with a proper lead-in so it looks exactly as it will in the export.
  let seenRedraw = 0;
  let settle: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const frame = Math.floor(time * profile.fps + 1e-6);
    const rd = redraw;
    if (!renderer || (frame === shown && rd === seenRedraw)) return;
    if (loopWraps !== seenWraps) { seenWraps = loopWraps; renderer.continueThroughJump = true; }
    if (frame === shown) {
      renderer.continueThroughJump = true;
      clearTimeout(settle);
      const r = renderer;
      settle = setTimeout(() => { if (renderer === r && shown === frame) { const t0 = performance.now(); r.renderFrame(frame); stats.preview(performance.now() - t0); } }, 250);
    }
    seenRedraw = rd;
    const t0 = performance.now();
    renderer.renderFrame(frame);
    stats.preview(performance.now() - t0);
    shown = frame;
  });

  const safe = $derived(profile.safeArea);
</script>

<div class="preview">
  <div class="box" style:aspect-ratio="{profile.width} / {profile.height}" bind:this={host}>
    {#if safe}
      <div class="safe" title="Safe area: Instagram crops Reels to this in the feed"
        style:left="{safe.x * 100}%" style:top="{safe.y * 100}%" style:width="{safe.w * 100}%" style:height="{safe.h * 100}%"></div>
    {/if}
  </div>
  {#if error}<div class="err">{error}</div>{/if}
  <div class="label mono">{profile.label} · {profile.width}×{profile.height} · {profile.fps} fps · preview {Math.round(scale * 100)}%</div>
</div>

<style>
  .preview { position: relative; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 12px; min-height: 0; gap: 6px; }
  .box { position: relative; max-width: 100%; max-height: calc(100% - 22px); height: 100%; background: #000;
    box-shadow: 0 0 0 1px var(--line2); }
  .box :global(canvas.frame) { width: 100%; height: 100%; display: block; }
  .safe { position: absolute; border: 1px dashed #f5a52499; pointer-events: none; }
  .label { color: var(--faint); font-size: 11px; }
  .err { position: absolute; inset: 12px; color: var(--danger); font: 12px var(--mono); white-space: pre-wrap; overflow: auto; background: #000c; padding: 8px; }
</style>
