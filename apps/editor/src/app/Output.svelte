<script lang="ts">
  import { onMount } from "svelte";
  import Preview from "./components/Preview.svelte";
  import { api } from "./lib/api.ts";
  import { openLink, type Msg } from "./lib/link.ts";
  import { getProfile, type Project } from "../../../../packages/core/src/index.ts";
  import type { FeatureTrack } from "../../../../packages/features/src/index.ts";

  /**
   * The output window: the editor's preview on its own (a second monitor, or a projector in full screen). It shows
   * what the editor sends, follows its playhead, and its layout handles edit the editor's session. Keys pressed
   * here go to the editor (Space plays, ⌘Z undoes); F toggles full screen.
   */
  let project = $state<Project | null>(null);
  let profileId = $state("youtube");
  let selected = $state<string | null>(null);
  let time = $state(0);
  let loopWraps = $state(0);
  let features = $state<Record<string, FeatureTrack> | null>(null);
  let featuresFps = 0;
  let connected = $state(false);
  let full = $state(false);
  const scaleParam = Number(new URLSearchParams(location.search).get("previewScale"));
  const scaleOverride = scaleParam > 0 && scaleParam <= 1 ? scaleParam : null;
  let link: ReturnType<typeof openLink>;

  function onmessage(m: Msg) {
    if (m.type === "show") { project = m.project; profileId = m.profileId; selected = m.selected; connected = true; }
    else if (m.type === "time") { time = m.time; loopWraps = m.loopWraps; }
    else if (m.type === "hello") link.send({ type: "here" });
    else if (m.type === "close") window.close();
  }
  // features at the format's frame rate (the server caches them)
  $effect(() => {
    const fps = getProfile(profileId).fps;
    if (!project || fps === featuresFps) return;
    featuresFps = fps; features = null;
    api.features(fps).then((f) => { if (featuresFps === fps) features = f; });
  });

  onMount(() => {
    link = openLink(onmessage);
    let closing = false;
    const beat = () => { if (!closing) link.send({ type: "here" }); };
    beat();
    const id = setInterval(beat, 1000);
    const bye = () => { closing = true; clearInterval(id); link.send({ type: "bye" }); };
    addEventListener("pagehide", bye);
    const onkey = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F") { toggleFull(); e.preventDefault(); return; }
      if (e.key === "Escape" && document.fullscreenElement) return;
      e.preventDefault();
      link.send({ type: "key", key: e.key, code: e.code, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey });
    };
    addEventListener("keydown", onkey);
    const onfs = () => (full = !!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onfs);
    (window as any).vizierOutput = { get state() { return { connected, profileId, selected, time, full, layers: project?.layers.length ?? 0 }; } };
    return () => { clearInterval(id); bye(); link.close(); removeEventListener("pagehide", bye); removeEventListener("keydown", onkey); document.removeEventListener("fullscreenchange", onfs); };
  });
  function toggleFull() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  }
</script>

<div class="output" class:full>
  {#if !connected}
    <div class="wait">Waiting for the editor… (this window shows the editor's preview; keep the editor open)</div>
  {:else}
    <Preview {project} {profileId} {features} {time} {loopWraps} {scaleOverride} qualityKey="out" selectedLayer={full ? null : selected}
      onselect={(id) => { selected = id; link.send({ type: "select", id }); }}
      onlayout={(id, t, final) => link.send({ type: "layout", id, t: { x: t.x, y: t.y, w: t.w, h: t.h, rotation: t.rotation ?? 0 }, final })} />
    {#if !full}
      <div class="bar">
        <button onclick={toggleFull} title="Full screen (F); Esc to leave">Full screen</button>
        <span>Keys here go to the editor: Space plays, ⌘Z undoes.</span>
      </div>
    {/if}
  {/if}
</div>

<style>
  .output { position: fixed; inset: 0; background: var(--bg0); display: flex; flex-direction: column; }
  .output.full { background: #000; }
  .output :global(.preview) { flex: 1; min-height: 0; }
  .output.full :global(.preview) { padding: 0; }
  .output.full :global(.preview .label) { display: none; }
  .output.full :global(.preview .box) { box-shadow: none; max-height: 100%; }
  .bar { display: flex; gap: 12px; align-items: center; padding: 4px 10px; font-size: 11px; color: var(--faint); background: var(--bg2); border-top: 1px solid var(--line2); }
  .bar button { font-size: 11px; padding: 2px 8px; }
  .wait { margin: auto; color: var(--dim); }
</style>
