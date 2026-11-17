# vizier

Audio-reactive visuals for music videos and live shows. One renderer, two drivers:

- **Offline**: stems + a project → frame-exact MP4s for YouTube, Shorts, Instagram.
- **Live**: the same renderer fullscreen on a projector. Today it plays a song with a dropped-frame HUD
  (`vizier live projects/<song> --video <video>`); live audio input and MIDI come later ([roadmap](docs/roadmap.md)).
- **Editor** (in progress): a local web app for arranging a video without editing files
  (`vizier editor projects/<song>`; see [`docs/editor.md`](docs/editor.md)).

Everything that changes over a song (geometry parameters, colours, text, layer position) is a
parameter. Its value comes from a stack, **base → automation lane → audio modulation → live override**,
so a render is reproducible and a live performance can be recorded as automation and re-rendered.

Architecture board: https://claude.ai/artifact/1VKzVCeq1iRTu9mL367st1 · Decisions: [`docs/adr/`](docs/adr/)

## Quick start

Needs Node 22+, pnpm, ffmpeg, and Google Chrome. On a Mac, follow [`docs/setup-mac.md`](docs/setup-mac.md).

```sh
pnpm install
pnpm test                                              # all tests (editor components in jsdom, the editor in Chrome)
pnpm typecheck                                         # TypeScript, including the editor's Svelte files
vizier demo                                            # generates the demo project's audio (see below)
vizier render projects/demo --video full --gpu         # → projects/demo/output/full-youtube.mp4
vizier render projects/demo --video reel --gpu         # a vertical Reel that builds on the full video
vizier live projects/demo --video full                 # then open http://localhost:5173 in Chrome
vizier editor projects/demo                            # the editor, in a Chrome window of its own
```

The demo's music is synthesised by code (`scripts/demo-audio.ts`), so the repository needs no audio files: a
32-bar, 128 BPM techno sketch with drums, an acid-style bass and a pad. It's the same every time `vizier demo` runs
(the "random" hi-hats come from a fixed seed), so renders and tests are repeatable.

`--gpu` renders with the GPU (leave it out for software rendering, e.g. on a server).

### Your own songs

Each song is a folder in `projects/` with its stems in `media/` (set one up with
[`docs/projects.md`](docs/projects.md#starting-a-new-project)). Then:

```sh
vizier render projects/<song> --video <video> --gpu                # e.g. projects/the-maleficus --video youtube-full
vizier render projects/<song> --video <video> --still-bar 85 --gpu # one frame, to check a moment
vizier render projects/<song> --video <video> --bars 81-97 --gpu   # an excerpt
vizier validate projects/<song>                                    # check the project's files
```

Renders go to `projects/<song>/output/` as `<video>-<format>.mp4` and replace the previous render of that name
(`--keep` adds a timestamp instead). `<video>` is a file name in `projects/<song>/videos/`, without `.json`.

## Layout

```
packages/features   audio → per-frame features (bands, envelope, onsets, centroid, spectrum). Pure TS, causal.
packages/core       formats (song/video), grid, automation, parameter stack, profiles, plugins (generators,
                    effects), JSON Schemas; browser/ holds the WebGL renderer and encoder
apps/offline        render, validate, analyze, migrate: tracks → features → headless Chrome → MP4 (encoded in Chrome)
apps/live           live window: local server + page that renders in time with the audio, frame-pacing HUD
apps/editor         editor: local server + Svelte 5 app; the session (project data + undo) lives in plain TS
projects/           one folder per song (only projects/demo/ is part of this repo)
scripts/            demo audio generator
assets/fonts        Special Elite (Apache 2.0, see LICENSE-SpecialElite.txt)
docs/               projects.md, editor.md, setup-mac.md, adding-a-generator.md, roadmap.md, adr/
```

## Projects

Each song is a folder with a `song.json` (tracks, tempo, sections, palette) and one file per video in `videos/`.
A video can build on another, so Reels reuse the full video's look with their own bar range and text.
See [`docs/projects.md`](docs/projects.md).

Generators: `acidRing`, `pulseGrid`, `typeText`, `ridgeline`, `flowField`. Effects: `glow`, `trails`.
Colours follow a five-slot palette (or a layer's own colours) and can be automated; see
[`docs/projects.md`](docs/projects.md#colour).
Adding visuals: [`docs/adding-a-generator.md`](docs/adding-a-generator.md).

## Licence

Apache-2.0 (see `LICENSE` and `NOTICE`). Special Elite font: Apache-2.0.
