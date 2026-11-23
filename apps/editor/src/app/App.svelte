<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { Session } from "./lib/session.ts";
  import { Transport } from "./lib/transport.ts";
  import { api, type Waveform } from "./lib/api.ts";
  import { handleKey, displayKeys, type Shortcut } from "./lib/shortcuts.ts";
  import { snapTime, beatSeconds } from "./lib/timeline.ts";
  import Timeline from "./components/Timeline.svelte";
  import Preview from "./components/Preview.svelte";
  import Help from "./components/Help.svelte";
  import LayerList from "./components/LayerList.svelte";
  import LayerPanel from "./components/LayerPanel.svelte";
  import VideoPanel from "./components/VideoPanel.svelte";
  import NewVideo from "./components/NewVideo.svelte";
  import TracksPanel, { type TrackCheck } from "./components/TracksPanel.svelte";
  import Projects from "./components/Projects.svelte";
  import TempoPanel, { type TempoGuess } from "./components/TempoPanel.svelte";
  import PalettePanel from "./components/PalettePanel.svelte";
  import PicturePanel from "./components/PicturePanel.svelte";
  import ColourPicker from "./components/ColourPicker.svelte";
  import type { LayerRow, SpanS, LaneRow, LanePoint } from "./components/Timeline.svelte";
  import { frontToBack, addTrack, setTrackFile, removeTrack, trackFiles, setDownbeat } from "./lib/edits.ts";
  import { paletteOf, paletteOrigin, setPaletteSlot, resetPaletteSlot, layerColor, layerColorHex, setLayerColor, addColorLane, colorLanesOf } from "./lib/edits.ts";
  import { setSpans, splitLayerAt, duplicateLayer, layerOf, setLayout, newVideo, lanesOfLayer, laneInherited, laneChanged, setLane, addLane, removeLane, resetLane } from "./lib/edits.ts";
  import type { Doc } from "./lib/session.ts";
  import { stats } from "./lib/stats.ts";
  import { openLink, type Msg } from "./lib/link.ts";
  import { featureAt } from "./lib/features.ts";
  import {
    barToSeconds, secondsToBar, barLabel, beatTimes, PALETTE_SLOTS, GENERATORS, colorTargets, colorLaneToSeconds, type LaneInput, nextBeatLine, sectionTimes, videoFormat, getProfile, spansToSeconds, laneToSeconds, paramTargets, EFFECTS, type Project, type BreakpointInput, type Span, type Transform,
  } from "../../../../packages/core/src/index.ts";
  import type { FeatureTrack } from "../../../../packages/features/src/index.ts";

  // ---- session ----
  let session = $state<Session | null>(null);
  let version = $state(0); // bumps on every session change
  let projectId = $state("");
  /** No project open (the editor was started without one): the start page. */
  let noProject = $state(false);
  let showProjects = $state(false);
  let videoName = $state<string | null>(null);
  let status = $state("loading…");
  let loadError = $state<string | null>(null);

  const doc = $derived.by(() => { void version; return session?.doc ?? null; });
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
  const dirtyFiles = $derived.by(() => { void version; return session?.dirtyFiles() ?? []; });
  const undoLabel = $derived.by(() => { void version; return session?.undoLabel ?? null; });
  const redoLabel = $derived.by(() => { void version; return session?.redoLabel ?? null; });

  // ---- audio, waveforms, features ----
  const transport = new Transport();
  let duration = $state(0);
  let time = $state(0);
  let playing = $state(false);
  let loop = $state(false);
  /** Waveforms by audio file (a track that gets a new file gets a new waveform). */
  let waves = $state<Record<string, Waveform | null>>({});
  async function loadWave(file: string) {
    if (file in waves) return;
    waves[file] = null;
    try { waves[file] = await api.waveform(file); } catch (e) { flash((e as Error).message); }
  }
  let features = $state<Record<string, FeatureTrack> | null>(null);
  let featuresFor = "";

  onMount(async () => {
    try {
      const data = await api.session();
      if ("noProject" in data) { noProject = true; return; }
      projectId = data.id;
      document.title = `vizier · ${data.song.title}`;
      const s = new Session({ song: data.song, videos: data.videos });
      s.subscribe(() => version++);
      session = s;
      videoName = data.initialVideo;
      const mix = data.song.tracks.find((t) => t.mix) ?? data.song.tracks[0]!;
      status = "loading audio…";
      duration = await transport.load(api.audioUrl(mix.file));
      loadedMix = mix.file;
      await Promise.all(data.song.tracks.map((t) => loadWave(t.file)));
      status = "ready";
    } catch (e) { loadError = (e as Error).message; }
  });

  // features of every track for the renderer
  // (at the open video's frame rate; fetched again only when that changes)
  $effect(() => {
    if (!videoName) return;
    const fps = getProfile(profileId).fps;
    const files = doc ? trackFiles(doc) : {};
    const key = `${fps}|${JSON.stringify(files)}`;
    if (key === featuresFor) return;
    featuresFor = key; features = null;
    api.features(fps, files).then((f) => { if (featuresFor === key) features = f; }).catch((e) => { projectErr = (e as Error).message; });
  });

  // ---- clock ----
  let loopWraps = $state(0);
  let lastTick = Infinity; // the playing position at the last frame (Infinity when stopped)
  let showStats = $state(false), perf = $state(stats.summary()), statsAt = 0;
  onMount(() => {
    let raf = 0;
    const tick = (ts: number) => {
      stats.frame(ts);
      if (showStats && ts - statsAt > 500) { statsAt = ts; perf = stats.summary(); }
      let t = transport.time(ts);
      const r = rangeSec;
      // Ableton-style: playback wraps only when it reaches the loop's end from before it; started after the loop,
      // it plays on
      if (playing && loop && r && t >= r.to && lastTick < r.to) { transport.seek(r.from); t = r.from; loopWraps++; }
      lastTick = playing ? t : Infinity;
      if (popped && (t !== sentTime || loopWraps !== sentWraps)) { link?.send({ type: "time", time: t, loopWraps }); sentTime = t; sentWraps = loopWraps; }
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
  // Opening a video (at start, or from the menu) puts the playhead at the start of its range: a reel opens on
  // its first bar. Only when the video changes, not when its range is edited.
  let openedVideo: string | null = null;
  $effect(() => {
    const v = videoName;
    if (!v || !session || v === openedVideo || status !== "ready") return;
    openedVideo = v;
    let p: Project;
    try { p = session.project(v); } catch { return; } // (read the video itself: `project` may still be the last one)
    const from = p.range?.from;
    if (from !== undefined && p.grid && !playing) seek(barToSeconds(from, p.grid));
  });
  function nudge(dir: number, beat: boolean) {
    const t = playing ? transport.time() : marker;
    if (!grid) return seek(Math.max(0, t + dir * 2));
    const eps = 1e-4;
    const bar = secondsToBar(t, grid);
    // the next bar/beat line strictly after (or before) the current position (beats in each bar's own metre)
    const next = beat ? nextBeatLine(bar, dir > 0 ? 1 : -1, grid) : dir > 0 ? Math.floor(bar + eps) + 1 : Math.ceil(bar - eps) - 1;
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
    let res: { written?: string[]; moved?: Record<string, string>; error?: string };
    try { res = await api.save(session.savePayload()); }
    catch { serverOnline = false; flash("can't reach the editor server: start it again (vizier editor …), then save; your changes are kept"); return; }
    if (res.error) { flash(`save failed: ${res.error}`); return; }
    session.renameFiles(res.moved ?? {});
    session.markSaved();
    flash(`saved ${res.written?.join(", ")}`);
  }
  function undo() { const l = session?.undo(); flash(l ? `undo: ${l}` : "nothing to undo"); }
  function redo() { const l = session?.redo(); flash(l ? `redo: ${l}` : "nothing to redo"); }
  let message = $state("");
  let messageTimer = 0;
  function flash(m: string) { message = m; clearTimeout(messageTimer); messageTimer = window.setTimeout(() => (message = ""), 2500); }

  let timeline = $state<Timeline>();
  let help = $state(false);
  // ---- tracks: waveforms, the mix's audio, checks against the mix, adding and replacing ----
  let loadedMix = "";
  // a track's new file (added, replaced, undone): its waveform; a new mix file: play that
  $effect(() => {
    if (!doc || status !== "ready") return;
    const files = doc.song.tracks.map((t) => t.file);
    untrack(() => { for (const f of files) void loadWave(f); });
    const mix = doc.song.tracks.find((t) => t.mix) ?? doc.song.tracks[0]!;
    if (mix.file !== loadedMix) {
      const f = mix.file; loadedMix = f;
      if (playing) togglePlay();
      transport.load(api.audioUrl(f)).then((d) => { if (loadedMix === f) duration = d; }).catch((e) => flash((e as Error).message));
    }
  });
  /** Each track's length and shift against the mix, by `file|mix file`. */
  let checks = $state<Record<string, TrackCheck | "checking">>({});
  const mixFile = $derived(doc ? (doc.song.tracks.find((t) => t.mix) ?? doc.song.tracks[0]!).file : "");
  $effect(() => {
    if (!doc || status !== "ready") return;
    const mix = mixFile, files = doc.song.tracks.map((t) => t.file);
    untrack(() => {
      for (const file of files) {
        const k = `${file}|${mix}`;
        if (k in checks) continue;
        checks[k] = "checking";
        api.trackCheck(file, mix).then((c) => { checks[k] = c; }).catch(() => { delete checks[k]; });
      }
    });
  });
  const checksByFile = $derived(Object.fromEntries((doc?.song.tracks ?? []).map((t) => [t.file, checks[`${t.file}|${mixFile}`]])));
  let media = $state<string[]>([]);
  const refreshMedia = () => api.media().then((m) => { media = m.map((x) => x.file); }).catch(() => {});
  let showTracks = $state(load("vizier.tracksOpen", "0") === "1");
  $effect(() => save_("vizier.tracksOpen", showTracks ? "1" : "0"));
  const isAudioName = (n: string) => /\.(wav|aif|aiff|flac|mp3|m4a|ogg)$/i.test(n);
  /** A dropped file goes to the server first (kept until the project is saved); a media/ file is used as is. */
  async function fileFor(f: File | string): Promise<string | null> {
    if (typeof f === "string") return f;
    if (!isAudioName(f.name)) { flash(`${f.name} isn't an audio file (wav, aiff, flac, mp3, m4a, ogg)`); return null; }
    flash(`adding ${f.name}…`);
    try { return await api.upload(f); } catch (e) { flash((e as Error).message); return null; }
  }
  async function addTrackFrom(f: File | string) {
    const file = await fileFor(f);
    if (!file) return;
    let id = "";
    edit(`add track ${typeof f === "string" ? f : f.name}`, (d) => { id = addTrack(d, file); });
    showTracks = true;
    flash(`added track "${doc?.song.tracks.find((t) => t.id === id)?.name}": save (${displayKeys("Mod+S")}) to keep it`);
  }
  async function replaceTrackWith(id: string, f: File | string) {
    const file = await fileFor(f);
    if (!file) return;
    const name = doc?.song.tracks.find((t) => t.id === id)?.name ?? id;
    edit(`replace ${name}`, (d) => setTrackFile(d, id, file));
    flash(`replaced the audio of ${name}: save (${displayKeys("Mod+S")}) to keep it (the old file is replaced)`);
  }
  function removeTrackNow(id: string) {
    const name = doc?.song.tracks.find((t) => t.id === id)?.name ?? id;
    let moved: string[] = [];
    edit(`remove track ${name}`, (d) => { moved = removeTrack(d, id); });
    flash(moved.length ? `removed ${name}: ${moved.join(", ")} now listen${moved.length === 1 ? "s" : ""} to the mix` : `removed ${name}`);
  }
  // Files dropped anywhere: on a track (its row in the panel or the timeline) replace its audio; elsewhere, add tracks
  let dragging = $state(false);
  function ondragover(e: DragEvent) { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); dragging = true; } }
  function ondragleave(e: DragEvent) { if (!e.relatedTarget) dragging = false; }
  async function ondrop(e: DragEvent) {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault(); dragging = false;
    const files = [...e.dataTransfer.files];
    const onTrack = (e.target as HTMLElement | null)?.closest?.("[data-track]")?.getAttribute("data-track");
    if (onTrack && files[0]) { await replaceTrackWith(onTrack, files[0]); return; }
    for (const f of files) await addTrackFrom(f);
  }

  // ---- tempo: the panel, what the mix suggests, the click ----
  let showTempo = $state(load("vizier.tempoOpen", "0") === "1");
  $effect(() => save_("vizier.tempoOpen", showTempo ? "1" : "0"));
  let detected = $state<TempoGuess | null>(null);
  let detectedFor = "";
  $effect(() => {
    if (!showTempo || !mixFile || detectedFor === mixFile) return;
    const f = mixFile; detectedFor = f; detected = null;
    api.tempo(f).then((d) => { if (detectedFor === f) detected = d; }).catch((e) => flash((e as Error).message));
  });
  let clicking = $state(false);
  function toggleClick() {
    clicking = !clicking;
    // (reads the grid as it is when each beat is scheduled, so tempo edits are heard straight away)
    transport.setClick(clicking ? (a, b) => { const g = session?.doc.song.grid; return g ? beatTimes(a, b, g) : []; } : null);
    flash(`click ${clicking ? "on" : "off"}`);
  }

  // ---- colour: the palette panel, layers' colours and the picker (one at a time) ----
  let showPalette = $state(load("vizier.paletteOpen", "0") === "1");
  $effect(() => save_("vizier.paletteOpen", showPalette ? "1" : "0"));
  type PickFor = { kind: "palette"; slot: string } | { kind: "layer"; layer: string; name: string } | { kind: "point"; target: string; index: number };
  let picking = $state<(PickFor & { at: { x: number; y: number } }) | null>(null);
  /** "Only in this video" for a palette slot being picked (it starts as the slot is). */
  let pickVideoOnly = $state(false);
  const palette = $derived(doc && videoName && doc.videos[videoName] ? paletteOf(doc, videoName) : {});
  const paletteSwatches = $derived(PALETTE_SLOTS.map((s) => ({ id: s.id, label: s.label, hex: palette[s.id] ?? s.default })));
  function openPicker(p: PickFor, at: { x: number; y: number }) {
    if (p.kind === "palette" && doc && videoName) pickVideoOnly = paletteOrigin(doc, videoName, p.slot) === "video";
    picking = { ...p, at };
  }
  /** What the picker shows: its colour, the slot it follows, its title. */
  const pickInfo = $derived.by(() => {
    const p = picking, v = videoName;
    if (!p || !doc || !v) return null;
    if (p.kind === "palette") return { value: palette[p.slot] ?? "#888888", slot: null, allowSlots: false, title: `Palette: ${PALETTE_SLOTS.find((s) => s.id === p.slot)?.label}` };
    if (p.kind === "layer") {
      const l = layerOf(doc, v, p.layer), set = layerColor(doc, v, p.layer, p.name);
      const label = l ? GENERATORS[l.generator]?.colors?.find((c) => c.name === p.name)?.label : p.name;
      return { value: layerColorHex(doc, v, p.layer, p.name), slot: set.startsWith("#") ? null : set, allowSlots: true, title: `${l?.name ?? p.layer}: ${label}` };
    }
    const ln = laneRows.find((l) => l.target === p.target), pt = ln?.points[p.index];
    return pt ? { value: pt.c ?? "#888888", slot: null, allowSlots: false, title: `${ln!.label}, at ${barLabel(toBar(pt.t), grid!)}` } : null;
  });
  function pickerChange(c: string, live: boolean) {
    const p = picking, v = videoName;
    if (!p || !v) return;
    if (p.kind === "palette") {
      const scope = pickVideoOnly ? "video" : "song";
      edit(`${p.slot} colour`, (d) => setPaletteSlot(d, v, p.slot, c, scope), live ? `palette.${p.slot}` : undefined);
    } else if (p.kind === "layer") edit("colour", (d) => setLayerColor(d, v, p.layer, p.name, c), live ? `${p.layer}.${p.name}.colour` : undefined);
    else setPointColour(p.target, p.index, c, live);
    if (!live) seal();
  }
  function setVideoOnly(on: boolean) {
    const p = picking, v = videoName;
    if (!p || p.kind !== "palette" || !v) return;
    pickVideoOnly = on;
    const c = palette[p.slot]!;
    if (on) edit(`${p.slot} colour in this video only`, (d) => setPaletteSlot(d, v, p.slot, c, "video"));
    else edit(`${p.slot} colour as the ${doc?.videos[v]?.base ? "base" : "song"}`, (d) => resetPaletteSlot(d, v, p.slot));
  }
  /** A on a colour: start a colour lane at the playhead with the colour, and show it (or show / hide it). */
  function automateColour(target: string, hex: string) {
    const v = videoName;
    if (!v) return;
    if (visibleLanes.has(target)) return hideLane(target);
    if (!laneRows.some((l) => l.target === target))
      edit("automate colour", (d) => addColorLane(d, v, target, grid ? { bar: toBar(playing ? time : marker) } : { t: playing ? time : marker }, hex));
    shownLanes = new Set([...shownLanes, target]);
  }
  function setPointColour(target: string, index: number, c: string, live: boolean) {
    const ln = laneRows.find((l) => l.target === target);
    if (!ln) return;
    lanePoints(target, ln.points.map((p, j) => (j === index ? { ...p, c } : p)), live ? `${target}.${index}.c` : undefined);
  }

  const shortcuts: Shortcut[] = [
    { keys: "Space", label: "Play / stop (stop returns to the start marker)", group: "Transport", run: togglePlay },
    { keys: "Shift+Space", label: "Continue from where playback stopped", group: "Transport", run: continuePlay },
    { keys: "L", label: "Loop the range", group: "Transport", run: () => (loop = !loop) },
    { keys: "C", label: "Click on every beat while playing (to check the grid)", group: "Transport", run: toggleClick },
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
    { keys: "Mod+E", label: "Split the selected layer at the playhead", group: "Layers", run: splitSelected },
    { keys: "Delete", alt: ["Backspace"], display: "Delete", label: "Remove the selected breakpoint or on-span", group: "Layers", run: () => { if (!deleteSelectedPoint()) deleteSelectedSpan(); } },
    { keys: "Mod+D", label: "Duplicate the selected layer", group: "Layers", run: duplicateSelected },
    { keys: "Mod+4", label: "Snap to the beat on / off", group: "Edit", run: () => { snap = !snap; flash(`snap to beat ${snap ? "on" : "off"}`); } },
    { keys: "I", label: "Show / hide frame timing (for diagnosing a jerky playhead)", group: "View", run: () => (showStats = !showStats) },
    { keys: "?", label: "Show / hide shortcuts", group: "View", run: () => (help = !help) },
    { keys: "Escape", label: "Close the shortcuts window; deselect a breakpoint", group: "View", run: () => { help = false; selectedPoint = null; } },
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
  const tracks = $derived(doc ? doc.song.tracks.map((t) => ({ id: t.id, name: t.name, mix: t.mix, wave: waves[t.file] ?? null })) : []);
  // front first: exactly the reverse of the renderer's drawing order (z, then the order in the file), ties included
  const layers = $derived(project ? frontToBack(project.layers) : []);

  // ---- editing layers ----
  let selectedLayer = $state<string | null>(null);
  let selectedSpan = $state<number | null>(null);
  $effect(() => { void videoName; selectedLayer = null; selectedSpan = null; });
  $effect(() => { if (selectedLayer && selectedLayer !== "_video" && !layers.some((l) => l.id === selectedLayer)) { selectedLayer = null; selectedSpan = null; } });
  function edit(label: string, fn: (d: Doc) => void, merge?: string) {
    if (!session || !videoName) return;
    try { session.apply(label, fn, { merge }); } catch (e) { flash(`couldn't ${label}: ${(e as Error).message}`); }
  }
  const seal = () => session?.seal();
  const selectLayer = (id: string | null, span: number | null = null) => { selectedLayer = id; selectedSpan = id === "_video" ? null : span; selectedPoint = null; };
  const trackName = (id: string | undefined) => {
    const t = doc?.song.tracks.find((t) => (id ? t.id === id : t.mix));
    return t?.name ?? id ?? "mix";
  };
  const mixId = $derived(doc?.song.tracks.find((t) => t.mix)?.id ?? "");
  // ---- automation lanes: shown under their layer when it's unfolded ----
  let shownLanes = $state(new Set<string>()); // lanes shown in the timeline (by target); hidden ones keep working
  let selectedPoint = $state<{ target: string; index: number } | null>(null);
  /** ▸ on a layer: show all its lanes, or hide them all if any are shown. */
  function toggleLanes(layer: string) {
    const mine = laneRows.filter((l) => l.layer === layer).map((l) => l.target);
    const n = new Set(shownLanes);
    if (mine.some((t) => n.has(t))) for (const t of mine) n.delete(t); else for (const t of mine) n.add(t);
    shownLanes = n;
  }
  const hideLane = (target: string) => { const n = new Set(shownLanes); n.delete(target); shownLanes = n; if (selectedPoint?.target === target) selectedPoint = null; };
  const targets = $derived(project ? paramTargets(project) : new Map());
  const ctargets = $derived(project ? colorTargets(project) : new Map<string, { label: string }>());
  /** The video's own lanes (palette colours, film grain, vignette) sit under a row of their own. */
  const VIDEO_ROW = "_video";
  const laneRows = $derived.by<LaneRow[]>(() => {
    if (!doc || !videoName || !doc.videos[videoName]) return [];
    const out: LaneRow[] = [];
    const d0 = doc, v0 = videoName;
    const origin = (target: string) => laneInherited(d0, v0, target) ? "base" as const : laneChanged(d0, v0, target) ? "changed" as const : "own" as const;
    const colourRow = (lane: LaneInput, layer: string, label: string) => {
      try {
        const pts = colorLaneToSeconds(lane, grid).points.map((p) => ({ t: p.t, v: 0, c: p.c, ...(p.curve ? { curve: p.curve } : {}), ...(p.hue ? { hue: p.hue } : {}) }));
        out.push({ target: lane.target, layer, label, min: 0, max: 1, int: false, points: pts, origin: origin(lane.target), color: true });
      } catch { /* a lane in bars without a grid */ }
    };
    // the video's own: palette colours and post (number lanes)
    for (const lane of colorLanesOf(doc, videoName, "palette.")) colourRow(lane, VIDEO_ROW, ctargets.get(lane.target)?.label ?? lane.target);
    for (const lane of (project?.automation ?? []).filter((a) => a.target.startsWith("post.") && a.points.length && a.points[0]!.c === undefined)) {
      const spec = targets.get(lane.target);
      if (!spec) continue;
      try { out.push({ target: lane.target, layer: VIDEO_ROW, label: spec.label, min: spec.min, max: spec.max, int: false, points: laneToSeconds(lane, grid).points.sort((a, b) => a.t - b.t), origin: origin(lane.target) }); } catch { /* no grid */ }
    }
    for (const l of layers) for (const lane of lanesOfLayer(doc, videoName, l.id)) {
      const spec = targets.get(lane.target);
      if (!spec) continue;
      const rest = lane.target.slice(l.id.length + 1);
      const fx = rest.includes(".") ? l.effects?.find((e) => (e.id ?? e.type) === rest.split(".")[0]) : undefined;
      let pts: LanePoint[] = [];
      try { pts = laneToSeconds(lane, grid).points.sort((a, b) => a.t - b.t); } catch { continue; }
      out.push({
        target: lane.target, layer: l.id, label: spec.label, ...(fx ? { effect: EFFECTS[fx.type]?.label ?? fx.type } : {}),
        min: spec.min, max: spec.max, int: (spec as { type?: string }).type === "int" || (spec as { type?: string }).type === "toggle", points: pts,
        origin: laneInherited(doc, videoName, lane.target) ? "base" : laneChanged(doc, videoName, lane.target) ? "changed" : "own",
      });
    }
    // layers' colour lanes
    for (const l of layers) for (const lane of colorLanesOf(doc, videoName, `${l.id}.`)) {
      const spec = ctargets.get(lane.target);
      if (spec) colourRow(lane, l.id, `${spec.label} colour`);
    }
    return out;
  });
  /** Breakpoints from the timeline (seconds) back to the file (bars when there's a tempo). */
  function lanePoints(target: string, pts: LanePoint[], merge?: string) {
    const v = videoName;
    if (!v) return;
    const colour = laneRows.find((l) => l.target === target)?.color;
    const file: BreakpointInput[] = pts.map((p) => ({ ...(grid ? { bar: toBar(p.t) } : { t: Math.round(p.t * 1000) / 1000 }),
      ...(colour ? { c: p.c ?? "#000000" } : { v: p.v }), ...(p.curve && p.curve !== "linear" ? { curve: p.curve } : {}), ...(colour && p.hue === "long" ? { hue: "long" as const } : {}) }));
    edit(colour ? "colour automation" : "automation", (d) => setLane(d, v, target, file), merge);
  }
  function pointLongWay(target: string, i: number, on: boolean) {
    const ln = laneRows.find((l) => l.target === target);
    if (!ln) return;
    lanePoints(target, ln.points.map((p, j) => (j === i ? (on ? { ...p, hue: "long" as const } : (({ hue: _h, ...rest }) => rest)(p)) : p)));
  }
  function laneCurve(target: string, i: number, curve: "linear" | "hold" | "smooth") {
    const ln = laneRows.find((l) => l.target === target);
    if (!ln) return;
    lanePoints(target, ln.points.map((p, j) => (j === i ? { ...p, curve } : p)));
  }
  function deleteSelectedPoint(): boolean {
    const sp = selectedPoint, v = videoName;
    const ln = sp && laneRows.find((l) => l.target === sp.target);
    if (!sp || !ln || !v) return false;
    if (ln.points.length <= 1) { edit("remove lane", (d) => removeLane(d, v, sp.target)); hideLane(sp.target); }
    else lanePoints(sp.target, ln.points.filter((_, j) => j !== sp.index));
    selectedPoint = null;
    return true;
  }
  /** Lanes that are shown and exist (a removed or undone lane isn't "shown", so A isn't lit for it). */
  const visibleLanes = $derived(new Set(laneRows.map((l) => l.target).filter((t) => shownLanes.has(t))));
  /** A in the layer panel: start a lane at the playhead with the current value and show it; on an automated
   *  parameter, show or hide its lane. */
  function automate(target: string, value: number) {
    const v = videoName;
    if (!v) return;
    if (visibleLanes.has(target)) return hideLane(target);
    if (!laneRows.some((l) => l.target === target))
      edit("automate", (d) => addLane(d, v, target, grid ? { bar: toBar(playing ? time : marker) } : { t: playing ? time : marker }, value));
    shownLanes = new Set([...shownLanes, target]);
  }
  const lanesPerLayer = $derived(laneRows.reduce((m, l) => m.set(l.layer, (m.get(l.layer) ?? 0) + 1), new Map<string, number>()));
  const layerRows = $derived<LayerRow[]>([
    // always there: click it for the palette, film grain and vignette (and their lanes)
    { id: VIDEO_ROW, name: "Palette & picture", track: mixId, spans: null, lanes: lanesPerLayer.get(VIDEO_ROW) ?? 0, fixed: true },
    ...layers.map((l) => ({
      id: l.id, name: l.name ?? l.id, track: l.track ?? mixId,
      spans: l.spans?.length && grid ? spansToSeconds(l.spans, grid) : null,
      lanes: lanesPerLayer.get(l.id) ?? 0,
    })),
  ]);
  const automated = $derived(new Set((project?.automation ?? []).map((a) => a.target)));
  const playheadBar = $derived(grid ? secondsToBar(playing ? time : marker, grid) : null);
  const startBar = $derived(grid ? secondsToBar(0, grid) : 1);
  const toBar = (t: number) => Math.round(secondsToBar(t, grid!) * 1000) / 1000;
  /** Spans changed on the timeline (seconds): back to bars, keeping each span's fades (in beats). */
  function spansFromTimeline(id: string, sec: SpanS[]) {
    if (!grid || !doc || !videoName) return;
    const orig: Span[] = [...(layerOf(doc, videoName, id)?.spans ?? [])].sort((a, b) => a.from - b.from);
    const next: Span[] = sec.map((s, i) => ({
      from: toBar(s.from), ...(s.to !== Infinity ? { to: toBar(s.to) } : {}),
      ...(orig[i]?.fadeIn ? { fadeIn: orig[i]!.fadeIn } : {}), ...(orig[i]?.fadeOut ? { fadeOut: orig[i]!.fadeOut } : {}),
    }));
    edit(sec.length > orig.length ? "add on-span" : "change on-span", (d) => setSpans(d, videoName!, id, next));
  }
  const family = $derived(getProfile(profileId).layout);

  // ---- the side panel takes the room the preview doesn't need (300–600 px; the preview is as tall as the stage allows) ----
  let mainW = $state(0), mainH = $state(0);
  const sideW = $derived.by(() => {
    const p = getProfile(profileId);
    const boxH = Math.max(0, mainH - 24 - 22 - 6); // stage padding, the label under the preview, the gap
    const previewW = (boxH * p.width) / p.height + 24 + 8;
    return Math.round(Math.min(600, Math.max(300, mainW - previewW)));
  });

  // ---- the preview in its own window (output window) ----
  // While it's open (it says so every second), the editor shows no preview of its own: the side panels spread out
  // and the timeline gets taller. Its layout handles and keys act on this editor.
  let link: ReturnType<typeof openLink> | null = null;
  let outputSeen = 0, byeAt = 0;
  let sentTime = NaN, sentWraps = -1; // the playhead the output window was last told
  let popped = $state(false);
  function onLinkMessage(m: Msg) {
    // (a heartbeat can still arrive just after the window said goodbye, while it closes)
    if (m.type === "here") { if (Date.now() - byeAt < 1500) return; outputSeen = Date.now(); if (!popped) popped = true; }
    else if (m.type === "bye") { byeAt = Date.now(); outputSeen = 0; popped = false; }
    else if (m.type === "select") selectLayer(m.id);
    else if (m.type === "layout") layoutFromPreview(m.id, m.t, m.final);
    else if (m.type === "key") window.dispatchEvent(new KeyboardEvent("keydown", { key: m.key, code: m.code, shiftKey: m.shiftKey, metaKey: m.metaKey, ctrlKey: m.ctrlKey, altKey: m.altKey, cancelable: true }));
  }
  onMount(() => {
    link = openLink(onLinkMessage);
    link.send({ type: "hello" }); // an output window left open from before answers
    const id = setInterval(() => { if (popped && Date.now() - outputSeen > 3000) popped = false; }, 500);
    return () => { clearInterval(id); link?.close(); };
  });
  // ---- timeline height: drag the grip on its top edge; remembered separately with the preview in and popped out.
  // Popped out, it starts at the height its rows need (the panels above get the rest).
  let tlContent = $state(0);
  let tlHeights = $state<{ in: number | null; out: number | null }>({
    in: Number(load("vizier.timelineHeight.in", "0")) || null, out: Number(load("vizier.timelineHeight.out", "0")) || null,
  });
  let winH = $state(window.innerHeight);
  onMount(() => { const r = () => (winH = window.innerHeight); addEventListener("resize", r); return () => removeEventListener("resize", r); });
  const tlMax = $derived(Math.max(140, winH - 42 - 24 - 140)); // leave room for the panels above
  const clampTl = (h: number) => Math.round(Math.min(tlMax, Math.max(120, h)));
  const tlRows = $derived.by(() => {
    const own = popped ? tlHeights.out : tlHeights.in;
    if (own) return `${clampTl(own)}px`;
    if (popped && tlContent) return `${clampTl(tlContent)}px`;
    return "minmax(170px, 34vh)";
  });
  function setTlHeight(h: number | null) {
    const k = popped ? "out" : "in";
    tlHeights = { ...tlHeights, [k]: h };
    save_(`vizier.timelineHeight.${k}`, h ? String(h) : "");
  }
  function gripDown(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = (el.parentElement as HTMLElement).getBoundingClientRect().height;
    const move = (ev: PointerEvent) => setTlHeight(clampTl(h0 - (ev.clientY - y0)));
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
    e.preventDefault();
  }
  /** Double-click the grip: just tall enough for every row. */
  function fitTimeline() { if (tlContent) setTlHeight(clampTl(tlContent)); }

  function popOut() {
    const q = new URLSearchParams({ view: "output" });
    if (previewParam && previewParam !== "0") q.set("previewScale", previewParam);
    const w = window.open(`/?${q}`, "vizier-output", "popup,width=1280,height=760");
    if (!w) flash("Chrome blocked the window: allow pop-ups for this page");
  }
  function bringBack() { link?.send({ type: "close" }); popped = false; outputSeen = 0; }
  // what the output window shows
  $effect(() => {
    if (!popped || !link) return;
    link.send({ type: "show", project: project ? $state.snapshot(project) as Project : null, profileId, selected: selectedLayer });
    sentTime = NaN; // and the playhead again
  });

  // ---- videos: new, duplicate; the open one must exist (undoing "new video" removes it) ----
  let newDialog = $state<null | "base" | "copy" | "blank">(null);
  function createVideo(o: { name: string; format: string; how: "blank" | "base" | "copy" }) {
    const from = videoName;
    newDialog = null;
    if (!from) return;
    let id = "";
    edit(`new video: ${o.name}`, (d) => { id = newVideo(d, { name: o.name, format: o.format, from: o.how === "blank" ? undefined : { video: from, how: o.how } }); });
    if (id) { videoName = id; flash(`made ${o.name}: save (⌘S) to write videos/${id}.json`); }
  }
  $effect(() => { if (doc && videoName && !doc.videos[videoName]) videoName = Object.keys(doc.videos).sort()[0] ?? null; });
  function layoutFromPreview(id: string, t: Transform, final: boolean) {
    const v = videoName, fam = family;
    if (!v) return;
    edit("move / resize layer", (d) => setLayout(d, v, id, fam, t), `layout:${id}`);
    if (final) seal();
  }
  function splitSelected() {
    if (!selectedLayer || selectedLayer === VIDEO_ROW || playheadBar === null || !videoName) { flash("select a layer to split it at the playhead"); return; }
    const id = selectedLayer, at = playheadBar, sb = startBar, v = videoName;
    let ok = false;
    edit("split at playhead", (d) => { ok = splitLayerAt(d, v, id, at, sb); });
    if (!ok) flash("nothing to split at the playhead: the layer is off there");
  }
  function deleteSelectedSpan() {
    if (!selectedLayer || selectedSpan === null || !doc || !videoName) return;
    const id = selectedLayer, i = selectedSpan, v = videoName;
    const sorted = [...(layerOf(doc, v, id)?.spans ?? [])].sort((a, b) => a.from - b.from);
    edit("remove on-span", (d) => setSpans(d, v, id, sorted.filter((_, j) => j !== i)));
    selectedSpan = null;
  }
  function duplicateSelected() {
    if (!selectedLayer || selectedLayer === VIDEO_ROW || !videoName) return;
    const id = selectedLayer, v = videoName;
    let nid = "";
    edit("duplicate layer", (d) => { nid = duplicateLayer(d, v, id); });
    if (nid) selectLayer(nid);
  }
  const rangeLabel = $derived(rangeBars && grid ? `bars ${barLabel(rangeBars.from ?? 1, grid)} – ${barLabel(rangeBars.to ?? secondsToBar(duration, grid), grid)}` : "whole song");
  const mmss = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
  const rangeTime = $derived.by(() => {
    const r = rangeSec ?? { from: 0, to: duration };
    return `${mmss(r.from)} – ${mmss(r.to)} · ${(r.to - r.from).toFixed(1)} s`;
  });

  // window API for end-to-end tests
  $effect(() => {
    (window as any).vizierEditor = {
      stats: () => ({ ...stats.summary(), ...stats.counts }),
      featureAt: (track: string, feature: string, t: number) => featureAt(features, track, feature, t),
      clicks: () => ({ ...transport.clickCount }),
      seek: (t: number) => seek(t),
      get state() { return { shownLanes: [...shownLanes], selectedPoint, popped, selectedLayer, selectedSpan, status, error: loadError, playing, transportPlaying: transport.playing, loop, loopWraps, time, marker, snap, syncMs, reportedLatency, videoName, dirtyFiles, range: rangeBars, undoLabel, serverOnline }; },
      timeline: () => timeline,
      clock: () => transport.clockInfo(),
      session: () => session,
    };
  });
</script>

{#if noProject}
  <Projects start />
{:else if loadError}
  <div class="fatal">Couldn't open the project: {loadError}</div>
{:else}
<div class="app" class:popped class:dragging {ondragover} {ondragleave} {ondrop} role="application" style:grid-template-rows="42px minmax(0, 1fr) {tlRows} 24px">
  <header class="top">
    <div class="brand">vizier</div>
    <button class="proj" onclick={() => (showProjects = true)} title="projects/{projectId}: open another project, or start a new one">{doc?.song.title ?? projectId}</button>
    <select bind:value={videoName} disabled={!doc} aria-label="Video">
      {#each videoNames as v}<option value={v}>{doc?.videos[v]?.name ?? v}{doc?.videos[v]?.base ? `  ← ${doc.videos[v].base}` : ""}</option>{/each}
    </select>
    <button class="small" onclick={() => (newDialog = "base")} disabled={!doc} title="Make a new video (build on this one, copy it, or start blank)">+ New</button>
    <button class="small" onclick={() => (newDialog = "copy")} disabled={!doc} title="An independent copy of this video">Duplicate</button>
    <span class="badge">{getProfile(profileId).label}</span>
    <div class="transport">
      <button class:on={playing} onclick={togglePlay} title="Play / stop ({displayKeys("Space")})">{playing ? "■" : "▶"}</button>
      <button class:on={loop} onclick={() => (loop = !loop)} title="Loop the range ({displayKeys("L")})">⟲</button>
      <button class="snap" class:on={snap} onclick={() => (snap = !snap)} title="Snap to the beat ({displayKeys("Mod+4")})">Snap</button>
      <button class="snap" class:on={clicking} onclick={toggleClick} title="Click on every beat while playing ({displayKeys("C")})">Click</button>
    </div>
    <div class="pos mono"><span class="bar">{position}</span><span class="dim">{clock(time)}</span>{#if bpm}<span class="dim">{bpm} BPM</span>{/if}</div>
    <div class="sect">{section}</div>
    <div class="spacer"></div>
    <button onclick={undo} disabled={!undoLabel} title="Undo {undoLabel ?? ""} ({displayKeys("Mod+Z")})">↶</button>
    <button onclick={redo} disabled={!redoLabel} title="Redo {redoLabel ?? ""} ({displayKeys("Shift+Mod+Z")})">↷</button>
    <button class:on={dirtyFiles.length > 0} onclick={save} title="Save ({displayKeys("Mod+S")})">Save{dirtyFiles.length ? " •" : ""}</button>
    <button onclick={() => (help = true)} title="Keyboard shortcuts ({displayKeys("?")})">?</button>
  </header>

  <main class:popped bind:clientWidth={mainW} bind:clientHeight={mainH}
    style:grid-template-columns={popped ? null : `minmax(0, 1fr) ${sideW}px`}>
    {#if !popped}
      <section class="stage">
        {#if !previewOff}<Preview {project} {profileId} {features} {time} scaleOverride={previewScale} {loopWraps}
          {selectedLayer} onselect={(id) => selectLayer(id)} onlayout={layoutFromPreview} />{/if}
        {#if projectErr}<div class="err">{projectErr}</div>{/if}
        {#if !features}<div class="note">analysing audio…</div>{/if}
        <button class="popout" onclick={popOut} title="Show the preview in its own window (a second screen or a projector); the editor gets more room">⧉ Pop out</button>
      </section>
    {/if}
    <aside class="inspector">
      <h3>Video</h3>
      {#if doc && videoName && doc.videos[videoName]}
        <VideoPanel {doc} video={videoName} {rangeLabel} {rangeTime} {rangeInherited} {edit} onopen={(v) => (videoName = v)} />
      {/if}
      <h3 class="fold-h"><button class="fold-btn" onclick={() => { showTracks = !showTracks; if (showTracks) refreshMedia(); }} aria-expanded={showTracks}
        title="{showTracks ? "Hide" : "Show"} the song's tracks (shared by every video)"><svg class="tri" class:open={showTracks} viewBox="0 0 10 10" width="12" height="12" aria-hidden="true"><path d="M2 0.5 L9 5 L2 9.5 Z" /></svg>Tracks</button>
        <span class="hint-inline">{doc?.song.tracks.length ?? 0} · shared by every video</span></h3>
      {#if showTracks && doc}
        <TracksPanel {doc} project={projectId} checks={checksByFile} {media} {edit} onadd={addTrackFrom} onreplace={replaceTrackWith} onremove={removeTrackNow} onrefreshmedia={refreshMedia} />
      {/if}
      <h3 class="fold-h"><button class="fold-btn" onclick={() => (showTempo = !showTempo)} aria-expanded={showTempo}
        title="{showTempo ? "Hide" : "Show"} the song's tempo and grid (shared by every video)"><svg class="tri" class:open={showTempo} viewBox="0 0 10 10" width="12" height="12" aria-hidden="true"><path d="M2 0.5 L9 5 L2 9.5 Z" /></svg>Tempo</button>
        <span class="hint-inline">{doc?.song.grid ? `${doc.song.grid.tempo[0]?.bpm} BPM${doc.song.grid.tempo.length > 1 ? ` + ${doc.song.grid.tempo.length - 1} change${doc.song.grid.tempo.length > 2 ? "s" : ""}` : ""}` : ""}</span></h3>
      {#if showTempo && doc}
        <TempoPanel {doc} {time} {detected} {clicking} {edit} seal={() => session?.seal()} onclick={toggleClick} />
      {/if}
      <h3 class="fold-h"><button class="fold-btn" onclick={() => (showPalette = !showPalette)} aria-expanded={showPalette}
        title="{showPalette ? "Hide" : "Show"} the palette: the colours layers follow"><svg class="tri" class:open={showPalette} viewBox="0 0 10 10" width="12" height="12" aria-hidden="true"><path d="M2 0.5 L9 5 L2 9.5 Z" /></svg>Palette</button>
        <span class="chips">{#each paletteSwatches as p (p.id)}<span class="chip" style:background={p.hex} title="{p.label}: {p.hex.toUpperCase()}"></span>{/each}</span></h3>
      {#if showPalette && doc && videoName}
        <PalettePanel {doc} video={videoName} {automated} shownLanes={visibleLanes} {edit} onpick={(slot, at) => openPicker({ kind: "palette", slot }, at)} onautomate={automateColour} />
      {/if}
      <h3>Layers <span class="hint-inline">front to back</span></h3>
      {#if videoName}
        <LayerList {layers} video={videoName} doc={doc ?? undefined} selected={selectedLayer} defaultTrack={undefined} {trackName} {edit} onselect={(id) => selectLayer(id)} />
      {/if}
      {#if !popped}{@render layerPanel()}{/if}
      {#if popped}
        <p class="hint">The preview is in its own window. <button class="small" onclick={bringBack}>Bring it back</button></p>
        {#if projectErr}<p class="hint err-inline">{projectErr}</p>{/if}
      {/if}
    </aside>
    {#if popped}<aside class="inspector">{@render layerPanel()}</aside>{/if}
  </main>

  {#snippet layerPanel()}
    {#if videoName && selectedLayer === VIDEO_ROW && doc}
      <h3 class="pic-h">Palette &amp; picture</h3>
      <PicturePanel {doc} video={videoName} {automated} shownLanes={visibleLanes} {edit} {seal}
        onpick={(slot, at) => openPicker({ kind: "palette", slot }, at)} onautomate={automate} onautomatecolour={automateColour} />
    {:else if videoName && selectedLayer && doc}
      <LayerPanel {doc} video={videoName} layerId={selectedLayer} tracks={doc.song.tracks} {playheadBar} {startBar} {automated} shownLanes={visibleLanes} {edit} {seal} {family} onautomate={automate} {time} {features}
        onpickcolor={(name, at) => openPicker({ kind: "layer", layer: selectedLayer!, name }, at)} onautomatecolor={automateColour}
        onselect={(id) => selectLayer(id)} />
    {:else if videoName}
      <p class="hint">Select a layer to edit it. Each layer also has a row under its track in the timeline: drag there to set when it's on.</p>
    {/if}
  {/snippet}

  <section class="tl">
    <div class="grip" role="separator" aria-orientation="horizontal" aria-label="Resize the timeline"
      title="Drag to resize the timeline; double-click to fit its rows" onpointerdown={gripDown} ondblclick={fitTimeline}></div>
    <Timeline bind:this={timeline} bind:contentHeight={tlContent} {grid} {sections} {tracks} layers={layerRows} {selectedLayer} {selectedSpan} {duration} {time} range={rangeSec} {rangeInherited}
      follow={playing} {marker} {snap} onseek={seek} onrange={setRange} onselectlayer={selectLayer} onspans={spansFromTimeline}
      ongrid={(d) => edit("move the grid", (doc) => setDownbeat(doc, d), "grid-drag")} ongriddone={() => session?.seal()}
      onpickpoint={(target, index, at) => { selectedPoint = { target, index }; openPicker({ kind: "point", target, index }, at); }}
      lanes={laneRows} {shownLanes} {selectedPoint} ontogglelanes={toggleLanes} onhidelane={hideLane}
      onselectpoint={(t, i) => { if (t) selectLayer(t.split(".")[0]!); selectedPoint = t && i !== null ? { target: t, index: i } : null; }}
      onlanepoints={lanePoints} onlanecurve={laneCurve}
      onlaneremove={(t) => { const v = videoName; if (v) edit("remove lane", (d) => removeLane(d, v, t)); hideLane(t); }}
      onlanereset={(t) => { const v = videoName; if (v) edit("lane: back to the base's", (d) => resetLane(d, v, t)); }} />
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
{#if picking && pickInfo}
  <ColourPicker value={pickInfo.value} slot={pickInfo.slot} palette={paletteSwatches} allowSlots={pickInfo.allowSlots} at={picking.at} title={pickInfo.title}
    onchange={pickerChange} onclose={() => (picking = null)}>
    {#if picking.kind === "palette"}
      <label title="Set this colour for this video only; the song's palette (and other videos) keep theirs">
        <input type="checkbox" checked={pickVideoOnly} onchange={(e) => setVideoOnly((e.currentTarget as HTMLInputElement).checked)} /> Only in this video</label>
    {:else if picking.kind === "point"}
      {@const ln = laneRows.find((l) => l.target === (picking as { target: string }).target)}
      {@const i = (picking as { index: number }).index}
      {#if ln && i < ln.points.length - 1}
        <label title="Fade to the next colour the other way round the colour wheel (green to red through blue and purple instead of yellow)">
          <input type="checkbox" checked={ln.points[i]!.hue === "long"} onchange={(e) => pointLongWay(ln.target, i, (e.currentTarget as HTMLInputElement).checked)} /> Fade the long way round</label>
      {/if}
    {/if}
  </ColourPicker>
{/if}
{#if showProjects}<Projects dirty={dirtyFiles} onclose={() => (showProjects = false)} />{/if}
{#if newDialog && videoName && doc}
  <NewVideo currentName={doc.videos[videoName]?.name ?? videoName} currentFormat={profileId} how={newDialog} oncreate={createVideo} oncancel={() => (newDialog = null)} />
{/if}

<style>
  .app { display: grid; grid-template-rows: 42px minmax(0, 1fr) minmax(170px, 34vh) 24px; grid-template-columns: minmax(0, 1fr);
    height: 100vh; width: 100vw; overflow: hidden; }
  main.popped { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  main.popped .inspector { border-left: none; border-right: 1px solid var(--line2); }
  .popout { position: absolute; top: 8px; right: 8px; font-size: 11px; padding: 2px 8px; opacity: .7; }
  .popout:hover { opacity: 1; }
  .err-inline { color: var(--danger); font-family: var(--mono); }
  .top { display: flex; align-items: center; gap: 10px; padding: 0 10px; background: var(--bg2); border-bottom: 1px solid var(--line2);
    min-width: 0; overflow: hidden; }
  .top select { min-width: 0; max-width: 220px; }
  .transport .snap { width: auto; padding: 3px 7px; font-size: 11px; }
  .offline { color: var(--danger); }
  .delay { display: flex; align-items: center; gap: 4px; }
  .delay button { padding: 0 6px; font-size: 11px; line-height: 16px; }
  .brand { font-weight: 600; letter-spacing: .04em; color: var(--accent); }
  .proj { font-weight: 500; background: none; border: none; padding: 0 4px; color: inherit; font-size: inherit; cursor: pointer; }
  .proj:hover { color: var(--accent); }
  .small { font-size: 11px; padding: 2px 7px; }
  .badge { font-size: 11px; color: var(--dim); border: 1px solid var(--line2); border-radius: 3px; padding: 1px 6px; }
  .transport { display: flex; gap: 4px; margin-left: 8px; }
  .transport button { width: 32px; padding: 3px 0; }
  .pos { display: flex; gap: 10px; align-items: baseline; margin-left: 6px; }
  .pos .bar { font-size: 15px; font-weight: 500; min-width: 54px; }
  .dim { color: var(--dim); }
  .sect { color: var(--accent); font-size: 12px; }
  .spacer { flex: 1; }
  main { display: grid; grid-template-columns: minmax(0, 1fr) 300px; min-height: 0; }
  .stage { position: relative; min-height: 0; background: var(--bg0); overflow: hidden; }
  .note { position: absolute; top: 12px; left: 12px; color: var(--dim); font-size: 12px; }
  .err { position: absolute; bottom: 30px; left: 12px; right: 12px; color: var(--danger); font: 12px var(--mono); }
  .inspector { background: var(--bg1); border-left: 1px solid var(--line2); padding: 10px 12px; overflow: auto; }
  h3 { margin: 6px 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--dim); font-weight: 500; }
  .fold-btn { background: none; border: none; padding: 0; color: inherit; font: inherit; text-transform: inherit; letter-spacing: inherit; cursor: pointer;
    display: inline-flex; align-items: center; gap: 6px; }
  .chips { display: inline-flex; gap: 3px; margin-left: 8px; }
  .chip { width: 10px; height: 10px; border-radius: 2px; border: 1px solid #fff2; }
  .tri { fill: var(--text); transition: transform .1s; }
  .tri.open { transform: rotate(90deg); }
  .fold-btn:hover .tri, .tri.open { fill: var(--accent); }
  .app.dragging { outline: 2px dashed var(--accent); outline-offset: -4px; }
  .hint-inline { text-transform: none; letter-spacing: 0; color: var(--faint); font-weight: 400; margin-left: 4px; }
  .hint { color: var(--faint); font-size: 11px; margin: 8px 0 14px; }
  .tl { position: relative; min-height: 0; min-width: 0; overflow: hidden; }
  .grip { position: absolute; top: 0; left: 0; right: 0; height: 6px; z-index: 3; cursor: ns-resize; }
  .grip::after { content: ""; position: absolute; left: 50%; top: 2px; width: 36px; height: 2px; margin-left: -18px; border-radius: 1px; background: var(--line2); }
  .grip:hover::after { background: var(--accent); }
  .status { display: flex; gap: 12px; align-items: center; padding: 0 10px; font-size: 11px; background: var(--bg2); border-top: 1px solid var(--line2); color: var(--dim); }
  .unsaved { color: var(--accent); }
  .fatal { padding: 40px; color: var(--danger); font: 14px var(--mono); }
</style>
