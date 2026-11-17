# Roadmap

Features we've discussed but not built yet. Tick items off in the commit that implements them.
Rough priority within each section is top to bottom. Decisions behind items live in [`adr/`](adr/).

## Phase 3: Editor (decided 2026-11-16; see ADR 0007 and ADR 0008)

Colour engine first (so it can be tested in renders before the UI exists):

- [ ] Try colour automation on the maleficus in real renders; revisit separate hue/brightness/saturation lanes
      if colour breakpoints + hue shift + lightness aren't expressive enough

Editor milestones:

- [ ] 2. Layer list (add, remove, reorder, choose generator, track, effects); parameter panel built from plugin
      declarations; drag/resize layers on the preview per format; inherited markers, reset to inherited, Open base;
      New / Duplicate / Detach video
- [ ] 3. Automation lanes: one per parameter, add/drag/delete breakpoints, curve types, beat snapping;
      audio-modulation editor (track + feature + amount)
- [ ] 4. Tracks like Ableton's (create, name, drop/replace/remove a stem; warn on length or alignment mismatch);
      tempo panel (typed BPM with detected suggestion, downbeat, drag the grid, audible click)
- [ ] 5. Colour pickers, palette panel and colour lanes; Render button with progress; list of renders
- [ ] Font comparison on screen: IBM Plex Sans Condensed + Plex Mono vs Space Grotesk + JetBrains Mono
- [ ] Output window as a second view of the session (projector / second monitor), edits applied live
- [ ] Later: pencil drawing of automation; finer snapping; record control moves (mouse or MIDI) as automation
- [ ] Type-check Svelte files (svelte-check needs a TypeScript 6 + 7 setup today)

## Phase 4: Platform polish (then: Reels/Shorts and the YouTube video for the maleficus)

- [ ] Named excerpts (in bars) per project, for Reels/Shorts; audio fade-in/out at excerpt ends
- [ ] Text cards: several timed text blocks per video (explaining the project, progress, the track's motivation)
- [ ] Safe-area guides in the editor preview for vertical formats
- [ ] Thumbnail / cover frame export
- [ ] Upload test: check colours of a WebCodecs export on YouTube and Instagram (Chrome writes full-range video;
      the libx264 path writes limited range). If they shift, convert range in the browser before encoding
- [ ] Release videos for the maleficus; repeat for the second song (in mixing)
- [ ] **Open question:** videos for earlier songs, or new tracks only?

## Later: live performance (on hold)

- [ ] Live headroom at 60 fps: p99 is 13 ms of the 16.7 ms budget with five layers and effects (M1 Pro). Before
      gigs: half-resolution glow, cheaper ridgeline drawing, or the live720 profile
- [ ] Test the live window on the projector (fullscreen on the projector's display, dropped frames, A/V offset)
- [ ] Remember the A/V offset per machine/output between sessions (set to −20 ms on the MacBook speakers)
- [ ] Live audio input per track group (bass, drums, synths, main). First test: several stereo BlackHole devices in
      Chrome at once; fallback: Node bridge reading a multichannel device, streaming features over WebSocket
- [ ] Clock sources: MIDI clock + Song Position Pointer via IAC (Web MIDI); Ableton Link via Node bridge; tap/internal
      tempo; audio-only
- [ ] Control input: MIDI controllers / Push 3 mapped to parameters (live overrides)
- [ ] Record a performance (control moves + events) and convert it to automation lanes for exact offline re-render
- [ ] Scene/section state machine in the renderer, triggered by MIDI notes, keys or the score
- [ ] Works with any source audio, not just Ableton (other performers via an audio interface)
- [ ] Decide on OBS's role (streaming/recording only, not in the concert path)

## Later: other ideas

- [ ] One command that renders several formats in a row (tabled; may not be needed)
- [ ] Tempo ramps (gradual tempo changes) in the tempo list
- [ ] Importing arrangement data from Live (`.als` file or MIDI export). Not the Extensions SDK: it may be
      missing or limited in Live 13

- [ ] More generators and effects over time (candidates: radial/Truchet rhythm grid, kaleidoscope, RGB-split glitch)
- [ ] Imported video clips and still images as layers (alongside live camera layers), with the same effects
- [ ] Live typing from the keyboard (recorded as events for replay)
- [ ] SVG layers (D3/SVG rendered to a texture)
- [ ] Camera layers: laptop camera and iPhone (Continuity Camera), with effects
- [ ] Project file schema validation with clear error messages
- [ ] Live window: a seek renders up to 3 s of feedback lead-in (about half a second on the M1 Pro); shorten
      it live, or render the lead-in at a lower frame rate
- [ ] Golden-image tests per machine (pixels differ between software GL and the Mac GPU)

## Done

- [x] Per-frame audio features (bands, envelope, onsets, centroid, spectrum), shared offline/live
- [x] Renderer core: layers with position, size, rotation, z, opacity, blend; WebGL2 compositor; film grain/vignette
- [x] Parameter stack: base → automation → audio modulation → live override
- [x] Automation lanes in bars or seconds; sections; constant tempo
- [x] Output profiles: YouTube (1080p30/60, 4K), Shorts, Reels (with 4:5 safe area), Instagram feed; per-profile layouts
- [x] Offline export to MP4 via headless Chrome + ffmpeg; stills; render-only benchmark
- [x] Text in Special Elite: fixed text, typing reveal, shake, stutter, blur
- [x] Mac setup guide; CI on GitHub
- [x] Benchmark reports p99, over-budget frames and the slowest frames
- [x] Faster export (M1 Pro: ~200 fps, full song in under a minute): H.264 encoded inside Chrome (WebCodecs, hardware where available), muxed by ffmpeg without re-encoding; post-render frame/duration check
- [x] Live window (playback mode): renders by the audio clock at the display's refresh rate; dropped-frame HUD; bar/section navigation; A/V offset
- [x] Plugin format: generators and effects in their own folders, declaring their parameters (drives validation,
      automation targets and the editor's controls); docs/adding-a-generator.md
- [x] Shader (GLSL) generators alongside Canvas 2D; per-layer effect chains with feedback and lead-in
- [x] New generators: ridgeline (chorus), flow field (drums, GLSL). Effects: glow, trails
- [x] Effects measured on the M1 Pro: 3.8 ms avg / 13.1 ms p99 per frame; full-song export still ~185 fps (0.9 min)
- [x] Phase 2 project structure (ADR 0006): `projects/<id>/` with `song.json` (tracks with fixed ids and names, mix,
      grid, sections) and `videos/*.json` that can build on each other; demo project with generated audio
- [x] Beat grid: tempo list (tempo and time-signature changes), downbeat offset for lead-ins, display offset
- [x] Per-project cache and `output/`; names `<video>-<profile>[-b<from>-<to>]` (overwrite; `--keep` timestamps);
      a snapshot `.json` beside each render; `--bars` and `--still-bar`
- [x] JSON Schemas; `pnpm validate`; `pnpm analyze` (tempo, bar 1, where tracks play, section suggestions);
      docs/projects.md
- [x] Drums (no kick) and chorus stems exported for the maleficus; drums and chorus layers in use
- [x] Colour engine (ADR 0008): five-slot palette (`acid` → `accent`); colours declared by generators, following
      palette slots or the layer's own; colour lanes blended in OKLCH; `hueShift` and `lightness` per layer
- [x] One `format` per video (replaces `profiles`); `pnpm migrate` updates old project files
- [x] Editor milestone 1: `pnpm edit`; Svelte 5 app with the session (project data, undo/redo, unsaved files) in plain
      TypeScript; video menu; play/stop; timeline (bar ruler, sections, waveforms, beat grid, zoom, scroll, follow);
      preview in the video's format with safe areas; range bracket (snap to beat); save; shortcut table and `?` overlay;
      end-to-end tests in headless Chrome
- [x] Feedback lead-in only after backward jumps or leaps over 1 s (slow frames no longer cascade); 1 s lead-in in the
      editor and live window
