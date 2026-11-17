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

  $effect(() => {
    if (!project || !features) return;
    const p = project, f = features, id = profileId, s = scale;
    let r: Renderer | null = null;
    try {
      r = new Renderer(p, id, f, "'Special Elite'", s);
      r.prerollSeconds = 1; // seeking should feel instant; trails are close enough after a second
      r.canvas.className = "frame";
      host.querySelector("canvas")?.remove();
      host.prepend(r.canvas);
      renderer = r;
      error = null;
      // untracked: this effect builds the renderer, and must rerun only when the project or format changes, not
      // whenever the playhead moves (reading `time` here used to rebuild the whole renderer on every frame)
      shown = Math.floor(untrack(() => time) * r.profile.fps + 1e-6);
      r.renderFrame(shown);
    } catch (e) { error = (e as Error).message; }
    return () => { r?.dispose(); if (renderer === r) renderer = null; };
  });

  // The preview shows whole frames at the video's frame rate, as the export will: a new frame only when the playhead
  // reaches it (30 a second for most formats), rather than one for every screen refresh (60 or 120 a second).
  let shown = -1;
  $effect(() => {
    const frame = Math.floor(time * profile.fps + 1e-6);
    if (!renderer || frame === shown) return;
    if (loopWraps !== seenWraps) { seenWraps = loopWraps; renderer.continueThroughJump = true; }
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
