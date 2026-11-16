# vizier

Audio-reactive visuals for music videos and live shows. One renderer, two drivers:

- **Offline**: stems + a project file → frame-exact MP4s for YouTube, Shorts, Instagram.
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
# put your stems next to the project: examples/<song>/media/main.wav, bass.wav, ...
pnpm render examples/the-maleficus/project.json --profile youtube            # whole song
pnpm render examples/the-maleficus/project.json --profile reels --start 60 --duration 15
pnpm render examples/the-maleficus/project.json --profile youtube --still 1200   # one frame as PNG
```

Add `--gpu` on a Mac to render with the GPU instead of software GL.

Profiles: `youtube` (1920×1080 30), `youtube60`, `youtube4k`, `shorts` and `reels` (1080×1920 30),
`igfeed` (1080×1350 30), `draft` (960×540). Each layer has a layout per family (landscape, portrait, feed),
so a vertical render is recomposed rather than cropped.

## Layout

```
packages/features   audio → per-frame features (bands, envelope, onsets, centroid, spectrum). Pure TS, causal.
packages/core       project model, automation, parameter stack, profiles; browser/ holds the WebGL renderer
apps/live           live window: local server + page that renders in time with the audio, frame-pacing HUD
apps/offline        CLI: decode stems (ffmpeg) → features → headless Chrome renders frames → ffmpeg → MP4
examples/           project files (audio is git-ignored)
assets/fonts        Special Elite (Apache 2.0, see LICENSE-SpecialElite.txt)
```

## Project files

See [`examples/the-maleficus/project.json`](examples/the-maleficus/project.json). Positions are in bars (1-based, like Live;
`33.5` = halfway through bar 33) when the project has a `tempo`, or in seconds with `t`.

- `layers[]`: `generator` (`acidRing`, `pulseGrid`, `typeText`, `ridgeline`, `flowField`), `stem`, `z`, `blend`,
  `opacity`, `params`, `layout`, `effects` (`glow`, `trails`). Adding visuals: [`docs/adding-a-generator.md`](docs/adding-a-generator.md).
- `automation[]`: lanes of breakpoints; targets are `<layer>.<param>`, `<layer>.<effect>.<param>` or `post.<param>`, `{ "target": "bass.radius", "points": [{ "bar": 49, "v": 1.0, "curve": "smooth" }, ...] }`.
  Curves: `linear`, `hold`, `smooth`. Layer transform (`x y w h rotation`) and `opacity` are automatable too.
- `modulations[]`: `{ "target": "bass.lineWidth", "source": "bass.env", "amount": 3, "curve": "square" }`.

Features available as sources: `rms env low lowMid mid high centroid flux onset`.

## Licence

Apache-2.0 (see `LICENSE` and `NOTICE`). Special Elite font: Apache-2.0.
