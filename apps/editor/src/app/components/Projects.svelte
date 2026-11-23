<script lang="ts">
  import { onMount } from "svelte";

  /**
   * Open a project in projects/, or make a new one: a title, then its audio (the mix and any stems), dropped from
   * Finder or chosen. Shown as the start page when the editor opens without a project, and from the project name
   * in the top bar.
   */
  let { start = false, dirty = [], onclose = () => {} }: {
    /** The editor's start page (no project open): no Cancel. */
    start?: boolean;
    /** Unsaved files in the open project: switching would lose them, so it waits until they're saved. */
    dirty?: string[];
    onclose?: () => void;
  } = $props();

  let projects = $state<{ id: string; title: string }[]>([]);
  let open = $state<string | null>(null);
  let loaded = $state(false);
  let title = $state("");
  let files = $state<File[]>([]);
  let mixIndex = $state(0);
  let busy = $state("");
  let error = $state("");
  let over = $state(false);
  const blocked = $derived(dirty.length > 0);
  // (as the server names it; it adds -2, -3… if the folder exists)
  const folderName = $derived(title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));

  onMount(async () => {
    const r = await (await fetch("/api/projects")).json();
    projects = r.projects; open = r.open; loaded = true;
  });
  const post = async (url: string, body: BodyInit, json = true) => {
    const r = await fetch(url, { method: "POST", body, headers: json ? { "content-type": "application/json" } : {} });
    const b = await r.json().catch(() => ({}));
    if (!r.ok || b.error) throw new Error(b.error ?? r.statusText);
    return b;
  };
  async function openProject(id: string) {
    try { busy = "opening…"; await post("/api/projects/open", JSON.stringify({ id })); location.reload(); }
    catch (e) { error = (e as Error).message; busy = ""; }
  }
  const audio = (f: File) => /\.(wav|aif|aiff|flac|mp3|m4a|ogg)$/i.test(f.name);
  /** The mix is the file named like one (mix, main, master, full), else the biggest. */
  function guessMix(fs: File[]) {
    const named = fs.findIndex((f) => /(^|[^a-z])(mix|main|master|full)([^a-z]|$)/i.test(f.name.replace(/\.[^.]+$/, "")));
    if (named >= 0) return named;
    return fs.reduce((best, f, i) => (f.size > fs[best]!.size ? i : best), 0);
  }
  function addFiles(list: FileList | File[] | null | undefined) {
    const add = [...(list ?? [])].filter(audio);
    const skipped = [...(list ?? [])].length - add.length;
    error = skipped ? `${skipped} file${skipped > 1 ? "s" : ""} skipped: not audio (wav, aiff, flac, mp3, m4a, ogg)` : "";
    if (!add.length) return;
    const had = files.length;
    files = [...files, ...add];
    if (!had) mixIndex = guessMix(files);
  }
  function removeFile(i: number) {
    files = files.filter((_, j) => j !== i);
    if (mixIndex === i) mixIndex = files.length ? guessMix(files) : 0;
    else if (mixIndex > i) mixIndex--;
  }
  async function create() {
    let id = "";
    try {
      busy = "making the folder…"; error = "";
      id = (await post("/api/projects/new", JSON.stringify({ title: title.trim() }))).id;
      const paths: string[] = [];
      for (const [i, f] of files.entries()) {
        busy = `copying ${f.name} (${i + 1} of ${files.length})…`;
        paths.push((await post(`/api/projects/media?id=${encodeURIComponent(id)}&name=${encodeURIComponent(f.name)}`, f, false)).file);
      }
      busy = "working out the tempo and where bar 1 starts…";
      await post("/api/projects/finish", JSON.stringify({ id, mix: paths[mixIndex], stems: paths.filter((_, i) => i !== mixIndex) }));
      location.reload();
    } catch (e) {
      error = (e as Error).message; busy = "";
      if (id) await post("/api/projects/discard", JSON.stringify({ id })).catch(() => {});
    }
  }
  const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
</script>

<div class="backdrop" class:start role="presentation" onkeydown={(e) => { e.stopPropagation(); if (e.key === "Escape" && !start && !busy) onclose(); }}>
  <div class="dialog" role="dialog" aria-label="Projects">
    {#if start}<h2>vizier</h2>{/if}
    {#if blocked}<p class="warn blocking" role="alert">Save (⌘S) or undo your changes first: switching projects would lose them. Unsaved: {dirty.join(", ")}.</p>{/if}

    {#if !loaded}<p class="dim small">Loading the projects…</p>{/if}
    {#if projects.length}
      <h3>Open a project</h3>
      <ul class="projects">
        {#each projects as p (p.id)}
          <li>
            <span>{p.title} <span class="dim">projects/{p.id}</span></span>
            {#if p.id === open}<em class="dim">open</em>{:else}<button onclick={() => openProject(p.id)} disabled={!!busy || blocked} title={blocked ? "Save or undo your changes first (see above)" : `Open ${p.title}`}>Open</button>{/if}
          </li>
        {/each}
      </ul>
    {/if}
    <h3>New project</h3>
    <label class="field">Title <input type="text" bind:value={title} placeholder="the song's title" disabled={!!busy}
      onkeydown={(e) => e.stopPropagation()} aria-label="Project title" /></label>
    <div class="drop" class:over role="button" tabindex="0" aria-label="Audio files for the new project"
      ondragover={(e) => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); e.stopPropagation(); over = true; } }}
      ondragleave={() => (over = false)}
      ondrop={(e) => { e.preventDefault(); e.stopPropagation(); over = false; addFiles(e.dataTransfer?.files); }}>
      Drop the mix and stems here, or
      <label class="choose">choose files<input type="file" multiple accept="audio/*,.wav,.aif,.aiff,.flac,.mp3,.m4a,.ogg"
        onchange={(e) => { addFiles((e.currentTarget as HTMLInputElement).files); (e.currentTarget as HTMLInputElement).value = ""; }} disabled={!!busy} /></label>
    </div>
    {#if files.length}
      <ul class="files">
        {#each files as f, i (f.name + f.size + i)}
          <li>
            <label title="The main mix: the finished song, the video's soundtrack"><input type="radio" name="mix" checked={mixIndex === i} onchange={() => (mixIndex = i)} disabled={!!busy} /> mix</label>
            <span class="fname">{f.name}</span><span class="dim">{mb(f.size)}</span>
            <button title="Leave it out" onclick={() => removeFile(i)} disabled={!!busy}>✕</button>
          </li>
        {/each}
      </ul>
      <p class="dim small">Select the <b>main mix</b>: the finished song. Its audio is the video's soundtrack, and the tempo is
        worked out from it. The other files become <b>stem tracks</b> (drums, bass, vocals…), named after their files:
        layers can react to any one of them, so a ring can pulse with the bass alone. Rename them later in Tracks.</p>
    {/if}
    <p class="dim small">Made in projects/{folderName || "…"} with an empty YouTube video. The tempo and where bar 1 starts are a first guess from the mix.</p>
    <div class="actions">
      {#if !start}<button onclick={onclose} disabled={!!busy}>Cancel</button>{/if}
      <button class="primary" onclick={create} disabled={!title.trim() || !files.length || !!busy || blocked}>Create</button>
    </div>
    {#if busy}<p class="busy">{busy}</p>{/if}
    {#if error}<p class="warn" role="alert">{error}</p>{/if}

  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, .55); display: flex; align-items: center; justify-content: center; z-index: 50; }
  .backdrop.start { background: var(--bg); }
  .dialog { background: var(--bg2); border: 1px solid var(--line); border-radius: 6px; padding: 16px 20px; width: 520px; max-height: 90vh; overflow: auto; }
  h2 { margin: 0 0 8px; color: var(--accent); font-weight: 500; }
  h3 { margin: 14px 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--dim); font-weight: 500; }
  .field { display: flex; align-items: center; gap: 8px; }
  .field input { flex: 1; }
  .drop { margin-top: 8px; padding: 14px; border: 1px dashed var(--line); border-radius: 4px; text-align: center; color: var(--dim); }
  .drop.over { border-color: var(--accent); color: var(--fg); }
  .choose { color: var(--accent); cursor: pointer; text-decoration: underline; }
  .choose input { display: none; }
  ul { list-style: none; padding: 0; margin: 8px 0; }
  li { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
  .fname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .projects li span:first-child { flex: 1; }
  .dim { color: var(--dim); }
  .small { font-size: 11px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
  .primary { border-color: var(--accent); }
  .warn { color: var(--warn, #e0a040); }
  .warn.blocking { color: var(--danger); font-weight: 500; border: 1px solid var(--danger); border-radius: 4px; padding: 6px 8px; margin: 0 0 8px; }
  .busy { color: var(--accent); }
</style>
