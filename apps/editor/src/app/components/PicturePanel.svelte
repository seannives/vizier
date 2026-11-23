<script lang="ts">
  import { POST_PARAMS } from "../../../../../packages/core/src/index.ts";
  import type { Doc } from "../lib/session.ts";
  import { postValue, setPost, postChanged, resetPost, modsOf } from "../lib/edits.ts";
  import ParamControl from "./ParamControl.svelte";
  import PalettePanel from "./PalettePanel.svelte";

  /**
   * "Palette & picture": what belongs to the whole video rather than a layer: the palette, film grain and vignette.
   * Opened by clicking its row at the top of the timeline.
   */
  let { doc, video, automated, shownLanes, edit, seal, onpick, onautomate, onautomatecolour }: {
    doc: Doc; video: string; automated: Set<string>; shownLanes: Set<string>;
    edit: (label: string, fn: (d: Doc) => void, merge?: string) => void; seal: () => void;
    onpick: (slot: string, at: { x: number; y: number }) => void;
    /** A on film grain or vignette: a lane ("post.<name>") with the current value. */
    onautomate: (target: string, value: number) => void;
    onautomatecolour: (target: string, hex: string) => void;
  } = $props();
  const hasBase = $derived(!!doc.videos[video]?.base);
</script>

<div class="picture">
  <h4>Palette</h4>
  <PalettePanel {doc} {video} {automated} {shownLanes} {edit} {onpick} onautomate={onautomatecolour} />
  <h4>Picture</h4>
  {#each POST_PARAMS as s (s.name)}
    <ParamControl spec={s} value={postValue(doc, video, s.name)} automated={automated.has(`post.${s.name}`)} laneShown={shownLanes.has(`post.${s.name}`)}
      modulated={modsOf(doc, video, `post.${s.name}`).length > 0}
      changed={postChanged(doc, video, s.name)} baseValue={hasBase ? postValue(doc, doc.videos[video]!.base!, s.name) : undefined}
      onreset={() => edit(`${s.label.toLowerCase()}: as the base`, (d) => resetPost(d, video, s.name))}
      onchange={(v, final) => { edit(s.label.toLowerCase(), (d) => setPost(d, video, s.name, v), `post.${s.name}`); if (final) seal(); }}
      onautomate={() => onautomate(`post.${s.name}`, postValue(doc, video, s.name))} />
  {/each}
</div>

<style>
  h4 { margin: 12px 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--dim); font-weight: 500; border-top: 1px solid var(--line); padding-top: 8px; }
  h4:first-child { border-top: none; padding-top: 0; margin-top: 0; }
</style>
