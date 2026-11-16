# vizier

Audio-reactive visuals for music videos and live shows. One renderer, two drivers:

- **Offline**: stems + a project → frame-exact MP4s for YouTube, Shorts, Instagram.
- **Live**: the same renderer fullscreen on a projector. Today it plays a song with a dropped-frame HUD
  (`pnpm live <project.json>`); live audio input and MIDI are next ([roadmap](docs/roadmap.md)).

Everything that changes over a song (geometry parameters, colours, text, layer position) is a
parameter. Its value comes from a stack, **base → automation lane → audio modulation → live override**,
so a render is reproducible and a live performance can be recorded as automation and re-rendered.

Architecture board: https://claude.ai/artifact/1VKzVCeq1iRTu9mL367st1 · Decisions: [`docs/adr/`](docs/adr/)

## Quick start

Needs Node 22+, pnpm, ffmpeg, and Google Chrome. On a Mac, follow [`docs/setup-mac.md`](docs/setup-mac.md).

```sh
pnpm install
pnpm test
pnpm demo                                            # generates the demo project's audio
pnpm render projects/demo --video full --gpu         # → projects/demo/output/full-youtube.mp4
pnpm render projects/demo --video reel --gpu         # a vertical Reel that builds on the full video
pnpm live projects/demo --video full                 # then open http://localhost:5173 in Chrome
```

`--gpu` renders with the GPU (leave it out for software rendering, e.g. on a server).

## Layout

```
packages/features   audio → per-frame features (bands, envelope, onsets, centroid, spectrum). Pure TS, causal.
packages/core       formats (song/video), grid, automation, parameter stack, profiles, plugins (generators,
                    effects), JSON Schemas; browser/ holds the WebGL renderer and encoder
apps/offline        render, validate, analyze: tracks → features → headless Chrome → MP4 (encoded in Chrome)
apps/live           live window: local server + page that renders in time with the audio, frame-pacing HUD
projects/           one folder per song (only projects/demo/ is part of this repo)
scripts/            demo audio generator
assets/fonts        Special Elite (Apache 2.0, see LICENSE-SpecialElite.txt)
docs/               projects.md (project files and commands), setup-mac.md, adding-a-generator.md, roadmap.md, adr/
```

## Projects

Each song is a folder with a `song.json` (tracks, tempo, sections) and one file per video in `videos/`.
A video can build on another, so Reels reuse the full video's look with their own bar range and text.
See [`docs/projects.md`](docs/projects.md).

Generators: `acidRing`, `pulseGrid`, `typeText`, `ridgeline`, `flowField`. Effects: `glow`, `trails`.
Adding visuals: [`docs/adding-a-generator.md`](docs/adding-a-generator.md).

## Licence

Apache-2.0 (see `LICENSE` and `NOTICE`). Special Elite font: Apache-2.0.
