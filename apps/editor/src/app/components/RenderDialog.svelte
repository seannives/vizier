<script lang="ts">
  import { api, type RenderJob, type RenderFile } from "../lib/api.ts";
  import { getProfile } from "../../../../../packages/core/src/index.ts";

  /**
   * Render from the editor: the open video (its range, or the whole song) or every video, with progress and Cancel;
   * then the renders in output/ to play, show in Finder or make again. Renders use the saved files, as the
   * `vizier render` command does, so it waits until changes are saved.
   */
  let { video, videoName, videos, rangeLabel, hasRange, coverLabel = "the first frame", dirty, jobs, files, onsave, onclose, onrefresh }: {
    /** The open video's id, and its name. */
    video: string; videoName: string;
    /** Every video: id → name. */
    videos: Record<string, string>;
    /** The open video's range, in words ("bars 81–97"), and whether it has one. */
    rangeLabel: string; hasRange: boolean;
    /** Where the open video's cover image is taken ("bar 33.5", or its first frame). */
    coverLabel?: string;
    /** Unsaved files: a render would use the saved ones. */
    dirty: string[];
    jobs: RenderJob[]; files: RenderFile[];
    onsave: () => void; onclose: () => void; onrefresh: () => void;
  } = $props();

  let which = $state<"video" | "song" | "all">("video");
  let playing = $state<string | null>(null);
  let error = $state("");
  const active = $derived(jobs.filter((j) => j.status === "queued" || j.status === "running"));
  /** How each video's last render ended (done, failed or cancelled), newest first; only while nothing newer for it is
   *  waiting or running, so an old "cancelled" never sits beside a render that's going (or done) since. */
  const recent = $derived.by(() => {
    const finished = jobs.filter((j) => j.status === "done" || j.status === "failed" || j.status === "cancelled");
    const last = new Map<string, RenderJob>();
    for (const j of finished) last.set(kind(j), j);              // (jobs are in the order they were added)
    return [...last.values()].filter((j) => !active.some((a) => kind(a) === kind(j) && a.id > j.id))
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)).slice(0, 3);
  });
  const isCover = (j: RenderJob) => !!j.args?.includes("--cover");
  const kind = (j: RenderJob) => `${j.video}|${j.whole}|${isCover(j)}`;
  const label = (j: RenderJob) => `${videos[j.video] ?? j.video}${isCover(j) ? ", cover image" : j.whole ? ", whole song" : ""}`;
  const isImage = (f: string) => f.endsWith(".jpg");
  const took = (j: RenderJob) => { const s = Math.round(((j.endedAt ?? 0) - (j.startedAt ?? 0)) / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; };

  async function start(videosToRender: string[], whole: boolean, options?: string[]) {
    error = "";
    try { await api.render(videosToRender, whole, options); onrefresh(); } catch (e) { error = (e as Error).message; }
  }
  const go = () => start(which === "all" ? Object.keys(videos) : [video], which === "song");
  /** The same render again (the same options: a draft, a few bars…), from the saved files as they are now. */
  const again = (f: RenderFile) => f.video && start([f.video], false, f.options);

  const pct = (j: RenderJob) => (j.total ? Math.floor((j.done / j.total) * 100) : 0);
  /** Time left, from the rate so far. */
  function eta(j: RenderJob) {
    if (!j.total || !j.done || !j.startedAt) return "";
    const s = ((Date.now() - j.startedAt) / j.done) * (j.total - j.done) / 1000;
    return s < 60 ? `${Math.ceil(s)} s left` : `${Math.ceil(s / 60)} min left`;
  }
  const mmss = (s?: number) => (s === undefined ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
  const mb = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n < 1e7 ? `${(n / 1e6).toFixed(2)} MB` : `${Math.round(n / 1e6)} MB`);
  const when = (f: RenderFile) => new Date(f.renderedAt ?? f.modified).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const formatLabel = (id?: string) => { try { return id ? getProfile(id).label : ""; } catch { return id ?? ""; } };
</script>

<svelte:window onkeydown={(e) => { if (e.key === "Escape") { e.stopPropagation(); if (playing) playing = null; else onclose(); } }} />
<div class="backdrop" role="presentation" onkeydown={(e) => e.stopPropagation()}>
  <div class="dialog" role="dialog" aria-label="Render">
    <div class="top"><h2>Render</h2><button class="x" onclick={onclose} title="Close (Esc); renders carry on">✕</button></div>

    {#if playing}
      <!-- svelte-ignore a11y_media_has_caption -->
      {#if isImage(playing)}<img src={api.outputUrl(playing) + `&t=${Date.now()}`} alt="Cover" />
      {:else}<video src={api.outputUrl(playing)} controls autoplay></video>{/if}
      <div class="row"><span class="dim">{playing.replace(/^output\//, "")}</span><button onclick={() => (playing = null)}>Close {isImage(playing) ? "the picture" : "the player"}</button></div>
    {/if}

    {#if dirty.length}
      <p class="warn" role="alert">Renders use the saved files, like <code>vizier render</code>: save first so the video is what you see.
        Unsaved: {dirty.join(", ")}. <button onclick={onsave}>Save</button></p>
    {/if}
    <div class="choose" role="radiogroup" aria-label="What to render">
      <label><input type="radio" name="which" value="video" bind:group={which} /> {videoName} <span class="dim">({hasRange ? rangeLabel : "the whole song"})</span></label>
      {#if hasRange}<label><input type="radio" name="which" value="song" bind:group={which} /> {videoName}, the whole song</label>{/if}
      {#if Object.keys(videos).length > 1}<label><input type="radio" name="which" value="all" bind:group={which} /> All {Object.keys(videos).length} videos <span class="dim">(each at its own range)</span></label>{/if}
    </div>
    <div class="row"><span class="dim">On the GPU, into the project's output/ folder; a render with the same name is replaced.</span>
      <button class="primary" onclick={go} disabled={dirty.length > 0}>Render</button></div>
    <div class="row"><span class="dim">The cover image for {videoName}: {coverLabel}, as a JPEG at the format's size, under YouTube's 2 MB limit
      (set its moment under the video's settings).</span>
      <button onclick={() => start([video], false, ["--cover"])} disabled={dirty.length > 0}>Cover image</button></div>
    {#if error}<p class="warn" role="alert">{error}</p>{/if}

    {#each active as j (j.id)}
      <div class="job" data-job={j.id}>
        <div class="row"><span>{label(j)}</span>
          <span class="dim">{j.status === "queued" ? "waiting" : j.total && !isCover(j) ? `${pct(j)}% · ${j.done}/${j.total} frames · ${eta(j)}` : "starting…"}</span>
          <button onclick={() => api.cancelRender(j.id).then(onrefresh)}>Cancel</button></div>
        <div class="bar"><div style:width="{pct(j)}%"></div></div>
      </div>
    {/each}
    {#each recent as j (j.id)}
      <div class="job {j.status}" data-job={j.id}>
        <div class="row"><span>{label(j)}:
          {j.status === "done" ? `done in ${took(j)}` : j.status === "failed" ? "failed" : "cancelled"}</span>
          {#if j.status === "done" && j.file}<span class="dim">{j.file.replace(/^output\//, "")}</span><button onclick={() => (playing = j.file!)}>{isImage(j.file) ? "View" : "Play"}</button>{/if}</div>
        {#if j.error}<pre>{j.error}</pre>{/if}</div>
    {/each}

    <h3>Renders <span class="dim">(output/)</span></h3>
    {#if !files.length}<p class="dim">None yet.</p>{/if}
    <ul class="files">
      {#each files as f (f.file)}
        <li data-file={f.file}>
          <div class="fname">{f.file.replace(/^output\//, "")}</div>
          <div class="meta dim">{formatLabel(f.profile)} · {isImage(f.file) ? "cover image" : mmss(f.seconds)} · {mb(f.bytes)} · {when(f)}{#if f.commit} · <span title="The vizier version it was made with{f.localChanges ? ', with uncommitted changes' : ''}">{f.commit}{f.localChanges ? "+" : ""}</span>{/if}</div>
          <div class="acts">
            <button onclick={() => (playing = f.file)} title={isImage(f.file) ? "Look at it here" : "Play it here"}>{isImage(f.file) ? "View" : "Play"}</button>
            <button onclick={() => api.reveal(f.file)} title="Show the file in Finder">Show in Finder</button>
            {#if f.video && videos[f.video]}<button onclick={() => again(f)} disabled={dirty.length > 0} title="Render it again the same way{f.options?.length ? ` (${f.options.join(" ")})` : ""}, from the saved files as they are now">Again</button>{/if}
          </div>
        </li>
      {/each}
    </ul>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, .55); display: flex; align-items: center; justify-content: center; z-index: 50; }
  .dialog { background: var(--bg2); border: 1px solid var(--line); border-radius: 6px; padding: 14px 18px; width: 620px; max-height: 90vh; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
  .top { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: 0; font-weight: 500; }
  h3 { margin: 10px 0 2px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--dim); font-weight: 500; }
  video, img { width: 100%; max-height: 50vh; object-fit: contain; background: #000; border-radius: 4px; }
  .choose { display: flex; flex-direction: column; gap: 4px; }
  .row { display: flex; align-items: center; gap: 8px; }
  .row > span:first-child { flex: 1; }
  .primary { border-color: var(--accent); }
  .dim { color: var(--dim); font-size: 12px; }
  .warn { color: var(--danger); border: 1px solid var(--danger); border-radius: 4px; padding: 6px 8px; margin: 0; }
  .job { padding: 6px 8px; background: var(--bg1); border-radius: 4px; }
  .job.failed { color: var(--danger); }
  .job.done { color: var(--text); border-left: 3px solid var(--accent); }
  .job.cancelled { color: var(--dim); }
  .job pre { white-space: pre-wrap; font-size: 11px; margin: 4px 0 0; color: var(--dim); }
  .bar { height: 4px; background: var(--bg3); border-radius: 2px; margin-top: 5px; overflow: hidden; }
  .bar div { height: 100%; background: var(--accent); transition: width .3s; }
  .files { list-style: none; padding: 0; margin: 0; }
  .files li { padding: 6px 0; border-bottom: 1px solid var(--line); display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; }
  .fname { font-family: var(--mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { grid-column: 1; }
  .acts { grid-column: 2; grid-row: 1 / span 2; display: flex; gap: 4px; align-items: center; }
  code { font-family: var(--mono); }
</style>
