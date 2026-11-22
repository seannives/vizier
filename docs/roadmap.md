# Roadmap

Features we've discussed but not built yet. Tick items off in the commit that implements them.
Rough priority within each section is top to bottom. Decisions behind items live in [`adr/`](adr/).

## Phase 3: Editor (decided 2026-11-16; see ADR 0007 and ADR 0008)

Colour engine first (so it can be tested in renders before the UI exists):

- [ ] Try colour automation on the maleficus in real renders; revisit separate hue/brightness/saturation lanes
      if colour breakpoints + hue shift + lightness aren't expressive enough

Editor milestones:

- [x] 2. In three parts:
  - [x] 2a. Layer list (add, remove, reorder, duplicate, rename); layer panel (generator, track, blend, text,
        parameters from plugin declarations, effect chain); when a layer is on (spans, rows on the timeline, ⌘E split);
        edits applied to the preview without restarting trails (ADR 0009)
  - [x] 2b. Drag/resize/rotate layers on the preview per layout family; snap to edges and centres of the frame
        and safe area; Layout section in the panel; resizing keeps a layer's shaders
  - [x] 2c. Inherited markers (base / changed / added), ↺ reset per setting and per layer, restore removed layers,
        Open base; Video section (name, format, base, range); New / Duplicate / Detach video
- [x] Preview in its own window: Pop out moves the preview to an output window (follows the editor, layout
      handles, keys go to the editor, F for full screen); the editor splits its panels and the timeline grows
- [x] 3. In two parts:
  - [x] 3a. Automation lanes under their layer (unfold ▸): add/drag/delete breakpoints, curves, beat snapping;
        A in the panel starts a lane; inherited lanes (base / changed / ↺)
  - [x] 3b. Audio modulation in the layer panel: M per parameter; track, feature, amount, curve; live meter;
        + another; inherited (base / changed / ↺)
- [x] **Bug sweep** (after 3b, before 4: milestone 4 changes tracks and tempo, which everything in bars rests on)
  - [x] Independent code review by a fresh reviewer, focused on the seams: seconds vs bars, pixels vs fractions
        of the frame, preview vs export, a video vs its base, every conversion between units. Found and fixed,
        each with a test: a new layer could take an id a reel already used; choosing Mix as an inherited
        layer's track was lost on save; layers with equal z were listed in the wrong order; the wrong span or
        breakpoint was selected after drawing one; beats counted across a metre change were off; a paused jump
        of a few frames didn't redraw at full quality; glow was twice as wide on a reduced-resolution layer;
        layers blended with transparent black, not the background colour; a modulation without an amount made
        NaN; the preview's first frame could be in a fallback font; the video panel read the format from only
        one base up; the full-screen output window could select and drag layers
  - [x] Rule-based tests over random sequences of edits (apps/editor/test/rules.test.ts): every edit leaves
        every video valid; undo then redo restores it exactly; saving and reloading changes nothing; only the
        edited video's file changes. Found: a reel broke when its base later added lanes for a layer the reel
        removed, deleted a layer the reel changed, or changed a layer's generator (fixed in how videos combine)
  - [x] Preview vs export for every generator and effect (apps/offline/test/preview-match.test.ts). Found: the
        pulse grid spaced dots at least 8 pixels apart, so a smaller preview showed fewer dots (fixed); the flow
        field's thin lines broke up at small sizes (now drawn a pixel wide and dimmed where they'd break up)
  - [x] A checklist session on the Mac with the maleficus (a reel, the pop-out on a second screen, shortcuts,
        speakers, GPU). Sync with AirPods matches the built-in speakers; a full 1080p render takes under a minute
        on the M1 Pro. Found and fixed: trails left a faint haze that never faded (8-bit feedback), which showed as
        a lighter rectangle where the acid ring's box is; a still at a bar showed the frame just before it
  - Then a lighter sweep every couple of milestones (mainly the rule-based tests)
- [ ] 4. In three parts:
  - [x] 4a. Tracks like Ableton's: Tracks panel; drop audio from Finder to add a track, or on a track to replace
        its audio (a replacement overwrites the old file on save); add or replace from media/; rename, reorder,
        remove (its layers and modulations move to the mix); each stem checked against the mix for length and
        for starting early or late
  - [ ] New project from the editor: a folder in projects/, a title, the mix and stems dropped in, a first video
        (decided 2026-11-22: between 4a and 4b, since a new song goes straight on to setting its tempo)
  - [ ] 4b. Tempo panel (typed BPM with detected suggestion, downbeat, drag the grid, audible click)
- [ ] 5. Colour pickers, palette panel and colour lanes; Render button with progress; list of renders
- [ ] Modulation presets: one-click combinations such as "pulse with the kick" or "colour follows the filter"
- [ ] Later: pencil drawing of automation; finer snapping; record control moves (mouse or MIDI) as automation

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
- [ ] Mute and solo for layers, like tracks in Live: M hides a layer, S shows only the soloed layers (several
      can be soloed). To decide: whether they affect only the preview while editing, or exports too

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
- [x] JSON Schemas; `vizier validate`; `vizier analyze` (tempo, bar 1, where tracks play, section suggestions);
      docs/projects.md
- [x] Drums (no kick) and chorus stems exported for the maleficus; drums and chorus layers in use
- [x] Colour engine (ADR 0008): five-slot palette (`acid` → `accent`); colours declared by generators, following
      palette slots or the layer's own; colour lanes blended in OKLCH; `hueShift` and `lightness` per layer
- [x] One `format` per video (replaces `profiles`); `vizier migrate` updates old project files
- [x] Editor milestone 1: `vizier editor`; Svelte 5 app with the session (project data, undo/redo, unsaved files) in plain
      TypeScript; video menu; play/stop; timeline (bar ruler, sections, waveforms, beat grid, zoom, scroll, follow);
      preview in the video's format with safe areas; range bracket (snap to beat); save; shortcut table and `?` overlay;
      end-to-end tests in headless Chrome
- [x] Feedback lead-in only after backward jumps or leaps over 1 s (slow frames no longer cascade); 1 s lead-in in the
      editor and live window
- [x] Editor feedback round 1: Ableton-style transport (start marker, ⇧Space continue), Snap toggle (⌘4), range in
      minutes:seconds, ← and ⇧← fixed, Return/fn← for go-to-start, shortcut list tidied, window shrinking fixed,
      ⌘-swipe zoom direction, audio delay setting, auto-open Chrome, server heartbeat and quit warning
- [x] Editor feedback round 2: Stop leaves the playhead where it is (Play jumps to the marker, ⇧Space continues);
      loops keep looping (seeking no longer briefly stops the transport); ⇧Space no longer caught by Space; "+" key
      shown and working; signed sync setting; simpler quit message; Space Grotesk + JetBrains Mono chosen
- [x] `vizier` command (bin/vizier) with `vizier help` and per-command help; pnpm scripts run through it
- [x] Editor round 3: snapping clicks, own Chrome window, smooth playhead (the preview had been rebuilding its
      renderer every frame; it now draws at the video's fps), frame-timing readout (I)
- [x] Svelte files type-checked (svelte-check with TypeScript 6 alongside TypeScript 7) and component tests (jsdom)
