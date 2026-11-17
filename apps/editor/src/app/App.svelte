<script lang="ts">
  import { onMount } from "svelte";
  import { Session } from "./lib/session.ts";
  import { Transport } from "./lib/transport.ts";
  import { api, type Waveform } from "./lib/api.ts";
  import { handleKey, displayKeys, type Shortcut } from "./lib/shortcuts.ts";
  import { snapTime, beatSeconds } from "./lib/timeline.ts";
  import Timeline from "./components/Timeline.svelte";
  import Preview from "./components/Preview.svelte";
  import Help from "./components/Help.svelte";
  import { stats } from "./lib/stats.ts";
  import {
    barToSeconds, secondsToBar, barLabel, sectionTimes, videoFormat, getProfile, GENERATORS, type Project,
  } from "../../../../packages/core/src/index.ts";
  import type { FeatureTrack } from "../../../../packages/features/src/index.ts";

  // ---- session ----
  let session = $state<Session | null>(null);
  let version = $state(0); // bumps on every session change
  let projectId = $state("");
  let videoName = $state<string | null>(null);
  let status = $state("loading…");
  let loadError = $state<string | null>(null);

  const doc = $derived((version, session?.doc ?? null));
  const videoNames = $derived(doc ? Object.keys(doc.videos).sort() : []);
  const ownVideo = $derived(doc && videoName ? doc.videos[videoName] ?? null : null);
  let project = $state<Project | null>(null);
  let projectErr = $state<string | null>(null);
  $effect(() => {
    void version;
    if (!session || !videoName) { project = null; return; }
    try { project = session.project(videoName); projectErr = null; } catch (e) { projectErr = (e as Error).message; project = null; }
  });
  const grid = $derived(project?.grid);
  const profileId = $derived.by(() => {
    void version;
    if (!session || !videoName) return "youtube";
    try { return videoFormat(session.video(videoName)) ?? "youtube"; } catch { return "youtube"; }
  });
  const dirtyFiles = $derived((version, session?.dirtyFiles() ?? []));
  const undoLabel = $derived((version, session?.undoLabel ?? null));
  const redoLabel = $derived((version, session?.redoLabel ?? null));

  // ---- audio, waveforms, features ----
  const transport = new Transport();
  let duration = $state(0);
  let time = $state(0);
  let playing = $state(false);
  let loop = $state(false);
  let waves = $state<Record<string, Waveform | null>>({});
  let features = $state<Record<string, FeatureTrack> | null>(null);
  let featuresFor = "";

  onMount(async () => {
    try {
      const data = await api.session();
      projectId = data.id;
      const s = new Session({ song: data.song, videos: data.videos });
      s.subscribe(() => version++);
      session = s;
      videoName = data.initialVideo;
      const mix = data.song.tracks.find((t) => t.mix) ?? data.song.tracks[0]!;
      status = "loading audio…";
      duration = await transport.load(api.audioUrl(mix.file));
      for (const t of data.song.tracks) waves[t.id] = null;
      await Promise.all(data.song.tracks.map(async (t) => { waves[t.id] = await api.waveform(t.file); }));
      status = "ready";
    } catch (e) { loadError = (e as Error).message; }
  });

  // features for the open video (its format's frame rate); reloaded when switching videos
  $effect(() => {
    const v = videoName;
    if (!v || v === featuresFor) return;
    featuresFor = v; features = null;
    api.features(v).then((f) => { if (featuresFor === v) features = f; }).catch((e) => { projectErr = (e as Error).message; });
  });

  // ---- clock ----
  let loopWraps = $state(0);
  let showStats = $state(false), perf = $state(stats.summary()), statsAt = 0;
  onMount(() => {
    let raf = 0;
    const tick = (ts: number) => {
      stats.frame(ts);
      if (showStats && ts - statsAt > 500) { statsAt = ts; perf = stats.summary(); }
      let t = transport.time(ts);
      const r = rangeSec;
      if (playing && loop && r && t >= r.to) { transport.seek(r.from); t = r.from; loopWraps++; }
      if (playing && !transport.playing) playing = false;
      time = t;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  // ---- range (stored in bars in the video file; shown in seconds) ----
  const rangeBars = $derived(project?.range ?? null);
  const rangeSec = $derived(rangeBars && grid ? {
    from: rangeBars.from !== undefined ? barToSeconds(rangeBars.from, grid) : 0,
    to: rangeBars.to !== undefined ? barToSeconds(rangeBars.to, grid) : duration,
  } : null);
  const rangeInherited = $derived(!!rangeBars && !ownVideo?.range);
  const round = (b: number) => Math.round(b * 1000) / 1000;
  function setRange(r: { from: number; to: number } | null) {
    if (!session || !videoName || !grid) return;
    const name = videoName;
    session.apply(r ? "set range" : "clear range", (d) => {
      const v = d.videos[name]!;
      if (r) v.range = { from: round(secondsToBar(r.from, grid)), to: round(secondsToBar(r.to, grid)) };
      else delete v.range;
    });
  }

  // ---- transport, Ableton-style ----
  // Play starts from the start marker. Stop leaves the playhead where playback stopped; the next Play jumps back to
  // the marker, ⇧Space continues from the stop point. Clicking the timeline (or the arrow keys) moves the marker.
  // With loop on, playback wraps at the range's end every time round.
  let marker = $state(0);
  let stoppedAt = 0;
  async function startFrom(from: number) {
    if (loop && rangeSec && from >= rangeSec.to) from = rangeSec.from;
    if (from >= duration - 0.05) from = rangeSec?.from ?? 0;
    await transport.play(from); playing = true;
  }
  async function togglePlay() {
    if (playing) { stoppedAt = transport.time(); transport.stop(); playing = false; time = stoppedAt; return; }
    await startFrom(marker);
  }
  async function continuePlay() {
    if (playing) return;
    await startFrom(stoppedAt);
  }
  const seek = (t: number) => { marker = t; stoppedAt = t; transport.seek(t); time = t; };
  function nudge(dir: number, beat: boolean) {
    const t = playing ? transport.time() : marker;
    if (!grid) return seek(Math.max(0, t + dir * 2));
    const step = beat ? 1 / (grid.tempo[0]?.beatsPerBar ?? 4) : 1;
    const eps = 1e-4;
    const bar = secondsToBar(t, grid);
    // the next bar/beat line strictly after (or before) the current position
    const next = dir > 0 ? (Math.floor((bar + eps) / step) + 1) * step : (Math.ceil((bar - eps) / step) - 1) * step;
    seek(Math.max(0, barToSeconds(next, grid)));
  }

  // ---- snap to the beat (⌘4, like Ableton's "Snap to Grid") ----
  let snap = $state(load("vizier.snap", "1") === "1");
  $effect(() => save_("vizier.snap", snap ? "1" : "0"));

  // ---- picture/sound sync: + moves the playhead and picture later, − earlier (remembered per browser) ----
  let syncMs = $state(Number(load("vizier.syncMs", "0")) || 0);
  let reportedLatency = $state(0);
  onMount(() => { const id = setInterval(() => (reportedLatency = transport.reportedLatencyMs), 1000); return () => clearInterval(id); });
  $effect(() => { transport.extraDelay = syncMs / 1000; save_("vizier.syncMs", String(syncMs)); });

  // per-browser settings; storage can be unavailable, so never let it break anything
  function load(k: string, d: string) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
  function save_(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* not available */ } }

  function rangeEdgeAtPlayhead(edge: "from" | "to") {
    if (!grid) return;
    const now = playing ? transport.time() : marker;
    const t = snap ? snapTime(now, grid) : now;
    const cur = rangeSec ?? { from: 0, to: duration };
    const r = edge === "from" ? { from: t, to: Math.max(t + beatSeconds(t, grid), cur.to) } : { from: Math.min(cur.from, t - beatSeconds(t, grid)), to: t };
    setRange(r);
  }
  async function save() {
    if (!session || !session.dirty) { flash("nothing to save"); return; }
    let res: { written?: string[]; error?: string };
    try { res = await api.save(session.savePayload()); }
    catch { serverOnline = false; flash("can't reach the editor server: start it again (vizier editor …), then save; your changes are kept"); return; }
    if (res.error) { flash(`save failed: ${res.error}`); return; }
    session.markSaved();
    flash(`saved ${res.written?.join(", ")}`);
  }
  function undo() { const l = session?.undo(); flash(l ? `undo: ${l}` : "nothing to undo"); }
  function redo() { const l = session?.redo(); flash(l ? `redo: ${l}` : "nothing to redo"); }
  let message = $state("");
  let messageTimer = 0;
  function flash(m: string) { message = m; clearTimeout(messageTimer); messageTimer = window.setTimeout(() => (message = ""), 2500); }

  let timeline: Timeline;
  let help = $state(false);
  const shortcuts: Shortcut[] = [
    { keys: "Space", label: "Play / stop (stop returns to the start marker)", group: "Transport", run: togglePlay },
    { keys: "Shift+Space", label: "Continue from where playback stopped", group: "Transport", run: continuePlay },
    { keys: "L", label: "Loop the range", group: "Transport", run: () => (loop = !loop) },
    { keys: "ArrowRight", label: "Forward a bar", group: "Transport", run: () => nudge(1, false) },
    { keys: "ArrowLeft", label: "Back a bar", group: "Transport", run: () => nudge(-1, false) },
    { keys: "Shift+ArrowRight", label: "Forward a beat", group: "Transport", run: () => nudge(1, true) },
    { keys: "Shift+ArrowLeft", label: "Back a beat", group: "Transport", run: () => nudge(-1, true) },
    { keys: "Enter", alt: ["Home"], display: "Return  or fn←", label: "Go to the range start (or the song start)", group: "Transport", run: () => seek(rangeSec?.from ?? 0) },
    { keys: "[", label: "Range starts at playhead", group: "Range", run: () => rangeEdgeAtPlayhead("from") },
    { keys: "]", label: "Range ends at playhead", group: "Range", run: () => rangeEdgeAtPlayhead("to") },
    { keys: "Shift+Backspace", label: "Clear the range (whole song)", group: "Range", run: () => setRange(null) },
    { keys: "+", alt: ["="], label: "Zoom in", group: "View", run: () => timeline?.zoomIn() },
    { keys: "-", label: "Zoom out", group: "View", run: () => timeline?.zoomOut() },
    { keys: "0", label: "Zoom to fit the song", group: "View", run: () => timeline?.fit() },
    { keys: "Mod+Z", label: "Undo", group: "Edit", run: undo },
    { keys: "Shift+Mod+Z", label: "Redo", group: "Edit", run: redo },
    { keys: "Mod+S", label: "Save", group: "Edit", run: save },
    { keys: "Mod+4", label: "Snap to the beat on / off", group: "Edit", run: () => { snap = !snap; flash(`snap to beat ${snap ? "on" : "off"}`); } },
    { keys: "I", label: "Show / hide frame timing (for diagnosing a jerky playhead)", group: "View", run: () => (showStats = !showStats) },
    { keys: "?", label: "Show / hide shortcuts", group: "View", run: () => (help = !help) },
    { keys: "Escape", label: "Close the shortcuts window", group: "View", run: () => (help = false) },
  ];
  // Tell the server we're here and whether there are unsaved changes (it warns before quitting), and notice
  // when the server isn't running (saving needs it; changes stay in the browser meanwhile).
  let serverOnline = $state(true);
  onMount(() => {
    const beat = async () => {
      try {
        await fetch("/api/heartbeat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dirty: !!session?.dirty }) });
        serverOnline = true;
      } catch { serverOnline = false; }
    };
    const id = setInterval(beat, 3000);
    void beat();
    return () => clearInterval(id);
  });

  onMount(() => {
    const onkey = (e: KeyboardEvent) => handleKey(shortcuts, e);
    const onbeforeunload = (e: BeforeUnloadEvent) => { if (session?.dirty) { e.preventDefault(); e.returnValue = ""; } };
    addEventListener("keydown", onkey); addEventListener("beforeunload", onbeforeunload);
    return () => { removeEventListener("keydown", onkey); removeEventListener("beforeunload", onbeforeunload); };
  });

  /** ?previewScale=0.25 renders a smaller preview (slow machines); ?previewScale=0 turns it off (automated tests). */
  const previewParam = new URLSearchParams(location.search).get("previewScale");
  const previewOff = previewParam === "0";
  const previewScale = (() => { const v = Number(previewParam); return v > 0 && v <= 1 ? v : null; })();

  // ---- display ----
  const sections = $derived(project && grid ? sectionTimes(project) : []);
  const position = $derived(grid ? barLabel(Math.max(-1, secondsToBar(time, grid)), grid) : "–");
  const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
  const bpm = $derived(grid?.tempo[0]?.bpm);
  const section = $derived([...sections].reverse().find((s) => s.t <= time + 1e-6)?.name ?? "");
  const tracks = $derived(doc ? doc.song.tracks.map((t) => ({ id: t.id, name: t.name, mix: t.mix, wave: waves[t.id] ?? null })) : []);
  const layers = $derived(project ? [...project.layers].sort((a, b) => b.z - a.z) : []);
  const rangeLabel = $derived(rangeBars && grid ? `bars ${barLabel(rangeBars.from ?? 1, grid)} – ${barLabel(rangeBars.to ?? secondsToBar(duration, grid), grid)}` : "whole song");
  const mmss = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
  const rangeTime = $derived.by(() => {
    const r = rangeSec ?? { from: 0, to: duration };
    return `${mmss(r.from)} – ${mmss(r.to)} · ${(r.to - r.from).toFixed(1)} s`;
  });

  // window API for end-to-end tests
  $effect(() => {
    (window as any).vizierEditor = {
      stats: () => stats.summary(),
      get state() { return { status, error: loadError, playing, transportPlaying: transport.playing, loop, loopWraps, time, marker, snap, syncMs, reportedLatency, videoName, dirtyFiles, range: rangeBars, undoLabel, serverOnline }; },
      timeline: () => timeline,
      clock: () => transport.clockInfo(),
      session: () => session,
    };
  });
</script>

{#if loadError}
  <div class="fatal">Couldn't open the project: {loadError}</div>
{:else}
<div class="app">
  <header class="top">
    <div class="brand">vizier</div>
    <div class="proj" title="project folder">{doc?.song.title ?? projectId}</div>
    <select bind:value={videoName} title="video" disabled={!doc}>
      {#each videoNames as v}<option value={v}>{doc?.videos[v]?.name ?? v}{doc?.videos[v]?.base ? `  ← ${doc.videos[v].base}` : ""}</option>{/each}
    </select>
    <span class="badge">{getProfile(profileId).label}</span>
    <div class="transport">
      <button class:on={playing} onclick={togglePlay} title="Play / stop ({displayKeys("Space")})">{playing ? "■" : "▶"}</button>
      <button class:on={loop} onclick={() => (loop = !loop)} title="Loop the range ({displayKeys("L")})">⟲</button>
      <button class="snap" class:on={snap} onclick={() => (snap = !snap)} title="Snap to the beat ({displayKeys("Mod+4")})">Snap</button>
    </div>
    <div class="pos mono"><span class="bar">{position}</span><span class="dim">{clock(time)}</span>{#if bpm}<span class="dim">{bpm} BPM</span>{/if}</div>
    <div class="sect">{section}</div>
    <div class="spacer"></div>
    <button onclick={undo} disabled={!undoLabel} title="Undo {undoLabel ?? ""} ({displayKeys("Mod+Z")})">↶</button>
    <button onclick={redo} disabled={!redoLabel} title="Redo {redoLabel ?? ""} ({displayKeys("Shift+Mod+Z")})">↷</button>
    <button class:on={dirtyFiles.length > 0} onclick={save} title="Save ({displayKeys("Mod+S")})">Save{dirtyFiles.length ? " •" : ""}</button>
    <button onclick={() => (help = true)} title="Keyboard shortcuts (?)">?</button>
  </header>

  <main>
    <section class="stage">
      {#if !previewOff}<Preview {project} {profileId} {features} {time} scaleOverride={previewScale} {loopWraps} />{/if}
      {#if projectErr}<div class="err">{projectErr}</div>{/if}
      {#if !features}<div class="note">analysing audio…</div>{/if}
    </section>
    <aside class="inspector">
      <h3>Layers</h3>
      {#each layers as l}
        <div class="layer">
          <div class="lname">{l.name ?? l.id}</div>
          <div class="lmeta">{GENERATORS[l.generator]?.label ?? l.generator}{l.track ? ` · ${doc?.song.tracks.find((t) => t.id === l.track)?.name ?? l.track}` : ""}{l.effects?.length ? ` · ${l.effects.map((e) => e.type).join(", ")}` : ""}</div>
        </div>
      {/each}
      <p class="soon">Editing layers, parameters and layout comes in milestone 2.</p>
      <h3>Range</h3>
      <div class="range">{rangeLabel}{#if rangeInherited}<span class="inh" title="from the base video">inherited</span>{/if}</div>
      <div class="range dim">{rangeTime}</div>
      <p class="hint">Drag in the bar ruler to set the range; drag its edges to adjust. Snap ({displayKeys("Mod+4")}) lines it up with beats; hold ⇧ while dragging to do the opposite.</p>
    </aside>
  </main>

  <section class="tl">
    <Timeline bind:this={timeline} {grid} {sections} {tracks} {duration} {time} range={rangeSec} {rangeInherited}
      follow={playing} {marker} {snap} onseek={seek} onrange={setRange} />
  </section>

  <footer class="status">
    <span>{message || status}</span>
    {#if !serverOnline}<span class="offline">editor server not running: start it again to save (your changes are kept)</span>{/if}
    <span class="spacer"></span>
    {#if showStats}<span class="mono perf" title="Display refresh rate; frames that missed a refresh, and the longest gap; what one preview frame costs (avg / max)">{perf.hz} Hz · late {perf.latePct}% (worst {perf.worstFrameMs} ms) · preview {perf.previewAvgMs} / {perf.previewMaxMs} ms</span>{/if}
    <span class="delay" title={`Lines the playhead and picture up with what you hear. If the sound comes after the playhead, press +; if it comes before, press −. (Chrome measures ${reportedLatency} ms between the audio clock and the speakers, already allowed for.)`}>
      sync
      <button onclick={() => (syncMs = Math.max(-500, syncMs - 10))}>−</button>
      <span class="mono">{syncMs > 0 ? "+" : ""}{syncMs} ms</span>
      <button onclick={() => (syncMs = Math.min(500, syncMs + 10))}>+</button>
      {#if syncMs !== 0}<button onclick={() => (syncMs = 0)} title="Reset to 0">0</button>{/if}
    </span>
    {#if dirtyFiles.length}<span class="unsaved">unsaved: {dirtyFiles.join(", ")}</span>{/if}
    <span class="dim">{projectId}/{videoName}</span>
  </footer>
</div>
{/if}

{#if help}<Help {shortcuts} onclose={() => (help = false)} />{/if}

<style>
  .app { display: grid; grid-template-rows: 42px minmax(0, 1fr) minmax(170px, 34vh) 24px; grid-template-columns: minmax(0, 1fr);
    height: 100vh; width: 100vw; overflow: hidden; }
  .top { display: flex; align-items: center; gap: 10px; padding: 0 10px; background: var(--bg2); border-bottom: 1px solid var(--line2);
    min-width: 0; overflow: hidden; }
  .top select { min-width: 0; max-width: 220px; }
  .transport .snap { width: auto; padding: 3px 7px; font-size: 11px; }
  .offline { color: var(--danger); }
  .delay { display: flex; align-items: center; gap: 4px; }
  .delay button { padding: 0 6px; font-size: 11px; line-height: 16px; }
  .brand { font-weight: 600; letter-spacing: .04em; color: var(--accent); }
  .proj { font-weight: 500; }
  .badge { font-size: 11px; color: var(--dim); border: 1px solid var(--line2); border-radius: 3px; padding: 1px 6px; }
  .transport { display: flex; gap: 4px; margin-left: 8px; }
  .transport button { width: 32px; padding: 3px 0; }
  .pos { display: flex; gap: 10px; align-items: baseline; margin-left: 6px; }
  .pos .bar { font-size: 15px; font-weight: 500; min-width: 54px; }
  .dim { color: var(--dim); }
  .sect { color: var(--accent); font-size: 12px; }
  .spacer { flex: 1; }
  main { display: grid; grid-template-columns: minmax(0, 1fr) 260px; min-height: 0; }
  .stage { position: relative; min-height: 0; background: var(--bg0); }
  .note { position: absolute; top: 12px; left: 12px; color: var(--dim); font-size: 12px; }
  .err { position: absolute; bottom: 30px; left: 12px; right: 12px; color: var(--danger); font: 12px var(--mono); }
  .inspector { background: var(--bg1); border-left: 1px solid var(--line2); padding: 10px 12px; overflow: auto; }
  h3 { margin: 6px 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--dim); font-weight: 500; }
  .layer { padding: 5px 7px; margin-bottom: 3px; background: var(--bg2); border: 1px solid var(--line); border-radius: 3px; }
  .lname { font-weight: 500; }
  .lmeta { color: var(--dim); font-size: 11px; }
  .soon, .hint { color: var(--faint); font-size: 11px; margin: 8px 0 14px; }
  .range { font-family: var(--mono); display: flex; gap: 8px; align-items: center; }
  .inh { font: 10px var(--ui); color: var(--dim); border: 1px dashed var(--line2); border-radius: 2px; padding: 0 4px; }
  .tl { min-height: 0; min-width: 0; overflow: hidden; }
  .status { display: flex; gap: 12px; align-items: center; padding: 0 10px; font-size: 11px; background: var(--bg2); border-top: 1px solid var(--line2); color: var(--dim); }
  .unsaved { color: var(--accent); }
  .fatal { padding: 40px; color: var(--danger); font: 14px var(--mono); }
</style>
