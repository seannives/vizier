# Roadmap

Features we've discussed but not built yet. Tick items off in the commit that implements them.
Rough priority within each section is top to bottom. Decisions behind items live in [`adr/`](adr/).

## Phase 1: Visual variety (so the editor has something to edit)

- [ ] Export the drums (no kick) and chorus stems for the-maleficus; tune the drums and chorus layers to them
- [ ] Colour as automatable parameters: per-layer colour (and project palette) that can change per section or
      drift over time; interpolate in a perceptual colour space (OKLCH) so fades don't go muddy; colour
      pickers in the editor
- [ ] Live headroom at 60 fps: p99 is 13 ms of the 16.7 ms budget with five layers and effects (M1 Pro). Before
      gigs: half-resolution glow, cheaper ridgeline drawing, or the live720 profile
- [ ] More generators and effects over time (candidates: radial/Truchet rhythm grid, kaleidoscope, RGB-split glitch)

## Phase 2: Importer and project organisation (discuss requirements first)

- [ ] **Open question:** where projects live. The repo should hold the code and a demo project; your own song
      projects probably belong in a separate folder (versioned in git or not). Rename `examples/` accordingly
- [ ] **Open question:** naming conventions for songs, projects, stems and renders, so many songs stay easy to find
- [ ] **Open question:** how tempo and sections get in: Live export (tempo map, locators/cue points, clip names),
      a control MIDI track, or entered in the editor
- [ ] **Open question:** starter scene templates: needed, or scope creep?
- [ ] Importer for Live's arrangement export (kept out of this public repo)
- [ ] Full tempo map behind the `bar` syntax; MIDI CC lanes from a control track as automation

## Phase 3: Editor MVP (replaces hand-editing project.json)

- [ ] Local web app (same kind of server as the live window), saving to the project file
- [ ] Transport: play, pause, scrub, loop a range; audio waveform; bar ruler; section markers
- [ ] Preview canvas per output profile; layers dragged and resized like in OBS; z-order, opacity, blend
- [ ] Layer list: add or remove layers, choose generator, stem and effects
- [ ] Parameter panel built from the generators' declarations
- [ ] Automation lanes on the timeline: add, move and delete breakpoints; curve types
- [ ] Render buttons per profile (calls the existing exporter)
- [ ] Later: record control moves (mouse or MIDI) as automation; undo history

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

- [ ] Choral-breakdown scene for the maleficus
- [ ] Live typing from the keyboard (recorded as events for replay)
- [ ] SVG layers (D3/SVG rendered to a texture)
- [ ] Camera layers: laptop camera and iPhone (Continuity Camera), with effects
- [ ] Project file schema validation with clear error messages
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
