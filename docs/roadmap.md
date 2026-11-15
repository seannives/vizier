# Roadmap

Features we've discussed but not built yet. Tick items off in the commit that implements them.
Rough priority within each section is top to bottom. Decisions behind items live in [`adr/`](adr/).

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
- [x] Faster export: H.264 encoded inside Chrome (WebCodecs, hardware where available), muxed by ffmpeg without re-encoding; post-render frame/duration check
- [x] Live window (playback mode): renders by the audio clock at the display's refresh rate; dropped-frame HUD; bar/section navigation; A/V offset

## Next

- [x] Measure the live window on the MacBook: 0 dropped frames at 60 Hz fullscreen, 1.2 ms avg / 2.9 ms p99 draw (2026-11-15)
- [ ] Test the live window on the projector (fullscreen on the projector's display, dropped frames, A/V offset)
- [ ] Remember the A/V offset per machine/output between sessions (set to −20 ms on the MacBook speakers)
- [ ] Upload test: check colours of a WebCodecs export on YouTube and Instagram (Chrome writes full-range video; the libx264 path writes limited range). If they shift, convert range in the browser before encoding
- [ ] Re-render the ozgun-acid clips with the bar-based arrangement; first full-song render

## Live performance

- [ ] Live audio input per track group (bass, drums, synths, main). First test: several stereo BlackHole devices in Chrome at once; fallback: Node bridge reading a multichannel device, streaming features over WebSocket
- [ ] Clock sources: MIDI clock + Song Position Pointer via IAC (Web MIDI); Ableton Link via Node bridge; tap/internal tempo; audio-only
- [ ] Control input: MIDI controllers / Push 3 mapped to parameters (live overrides)
- [ ] Record a performance (control moves + events) and convert it to automation lanes for exact offline re-render
- [ ] Scene/section state machine in the renderer, triggered by MIDI notes, keys or the score
- [ ] Projector profile at the projector's native resolution; frame pacing checks at 60 fps
- [ ] Works with any source audio, not just Ableton (other performers via an audio interface)

## Visuals

- [ ] Layers for drums, synths and main from their own stems
- [ ] More generators; shader-based generators and per-layer effect chains (blur, feedback, kaleidoscope, burn, psychedelia)
- [ ] Choral-breakdown scene for ozgun-acid
- [ ] Live typing from the keyboard (recorded as events for replay)
- [ ] SVG layers (D3/SVG rendered to a texture)
- [ ] Camera layers: laptop camera and iPhone (Continuity Camera), with effects
- [ ] Safe-area guides drawn in preview for vertical formats

## Authoring and data

- [ ] Import arrangement from Live (tempo map, cue points, clips, control-track MIDI) into project files; importer kept out of this public repo
- [ ] Full tempo map behind the `bar` syntax (tempo changes)
- [ ] Import MIDI CC lanes from a control track as automation
- [ ] Editor UI: layer layout (drag/resize like OBS), parameter controls, automation lane editing
- [ ] Project file schema validation with clear error messages

## Infrastructure

- [ ] Golden-image tests per machine (pixels differ between software GL and the Mac GPU)
- [ ] Decide on OBS's role (streaming/recording only, not in the concert path)
