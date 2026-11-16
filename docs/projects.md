# Projects

A project is one song, in its own folder under `projects/`. The folder name is the project's id: lowercase,
hyphens, no spaces (`my-single`, `acid-ep-track-two`). Titles and other details live in the files.

```
projects/demo/
  song.json                 the song: tracks (stems), tempo and grid, sections, palette
  videos/
    full.json               one file per video
    reel.json               can build on another video ("base")
  media/                    audio files
  output/                   renders, plus a .json snapshot of how each was made
  .cache/                   audio analysis (safe to delete)
```

vizier's git repository ignores everything in `projects/` except `projects/demo/`. Your own projects can be a
separate private git repository (see [setup-mac.md](setup-mac.md#keeping-your-projects-in-their-own-git-repo)).
Keep `media/`, `output/` and `.cache/` out of it.

## song.json

```json
{
  "version": 2,
  "title": "vizier demo",
  "tracks": [
    { "id": "mix",   "name": "Mix",   "file": "media/mix.wav", "mix": true },
    { "id": "drums", "name": "Drums", "file": "media/drums.wav" },
    { "id": "bass",  "name": "Bass",  "file": "media/bass.wav" },
    { "id": "pad",   "name": "Pad",   "file": "media/pad.wav" }
  ],
  "grid": { "tempo": [{ "bar": 1, "bpm": 128, "beatsPerBar": 4 }], "downbeat": 0.75 },
  "sections": [{ "bar": 1, "name": "intro" }, { "bar": 9, "name": "groove" }, { "bar": 25, "name": "break" }],
  "palette": { "bg": "#2B2420", "ink": "#FCFCFB", "acid": "#B6FF3B" }
}
```

- **Tracks** work like Ableton's: a track has a fixed `id` (used everywhere else), a display `name` you can
  change freely, and an audio `file`. Exactly one track is the `mix`: its audio goes into the video.
  Every stem must start at the same moment as the mix, so export them all from the same start point in Live.
- **Grid**: `tempo` is a list (one entry for a steady song; add entries for tempo or time-signature changes).
  `downbeat` is where bar 1 starts in the mix file, in seconds: set it when your export starts with a lead-in
  before the music. Bars are vizier's own: bar 1 is the first downbeat, the lead-in is bar 0.x.
  `barLabelOffset` (optional) only changes how bars are displayed, e.g. 16 to match a Live arrangement where the
  music starts at bar 17.
- Bars are 1-based and fractional: `33` is the first beat of bar 33, `33.5` halfway through it.

## videos/*.json

```json
{
  "version": 2,
  "name": "Reel: the break",
  "base": "full",
  "profiles": ["reels", "shorts"],
  "range": { "from": 21, "to": 31 },
  "layers": [
    { "id": "caption", "generator": "typeText", "z": 5, "text": "the break",
      "layout": { "portrait": { "x": 0.5, "y": 0.2, "w": 0.9, "h": 0.06 } } }
  ],
  "automation": [{ "target": "caption.reveal", "points": [{ "bar": 25, "v": 0 }, { "bar": 26, "v": 1 }] }]
}
```

- `profiles`: output formats (`youtube`, `youtube60`, `youtube4k`, `shorts`, `reels`, `igfeed`, `draft`); the first
  is the default for `pnpm render`.
- `range`: bars, where `to` is exclusive (21–31 = bars 21 to 30). Leave it out for the whole song.
- `layers`: each has an `id`, an optional `name`, a `generator`, the `track` it listens to (default: the mix),
  `z`, `blend`, `opacity`, `params`, `effects`, `text` and a `layout` per shape (`landscape`, `portrait`, `feed`).
- `automation`: lanes of breakpoints in bars (or seconds with `t`); targets are `<layer>.<param>`,
  `<layer>.<effect>.<param>` or `post.<param>`. Curves: `linear`, `hold`, `smooth`.
- `modulations`: audio driving a parameter: `{ "target": "chorus.opacity", "source": "chorus.env", "amount": 1.4 }`.

### Building on another video (`base`)

A video with `base` starts from that video and changes only what it lists:

- a layer with an existing id overrides that layer's fields (`params` and `layout` merge; `effects` replace);
  `"remove": true` drops it; a new id adds a layer;
- an automation lane replaces the base's lane for the same target (an empty `points` list removes it);
- a modulation replaces the base's one with the same target and source (`"remove": true` drops it);
- everything else (`profiles`, `range`, `seed`, `palette`) overrides.

Because automation is placed in song bars, a Reel of bars 21–31 shows exactly what the full video shows there,
plus its own changes. Improve the full video and every Reel built on it follows.

## Commands

```sh
pnpm render projects/demo --video full --gpu                       # its own range and first profile
pnpm render projects/demo --video reel --profile shorts --gpu
pnpm render projects/demo --video full --bars 21-31 --profile reels --gpu
pnpm render projects/demo --video full --still-bar 13 --gpu
pnpm render projects/demo --video full --keep --gpu                # keep: adds a timestamp
pnpm live   projects/demo --video full
pnpm validate projects/demo
pnpm analyze  projects/demo              # or a folder of stems with no song.json yet
```

`--video` can be left out when a project has only one video.

Renders are named `<video>-<profile>[-b<from>-<to>].mp4` and **replace the previous render with the same name**.
Rename or move a render to keep it, or use `--keep`, which adds a timestamp (`…-20261116T130102.mp4`). Each render
writes a `.json` snapshot next to it: the song and the resolved video exactly as rendered, the command, and the
vizier version, so it can be reproduced later. Watch disk space: a full 1080p song is about 550 MB.

## Starting a new project

1. `mkdir -p projects/<id>/media` and copy in the mix and stems.
2. `pnpm analyze projects/<id>` suggests the tempo, where bar 1 starts, where each stem plays and likely
   section changes (suggestions to check, not answers).
3. Write `song.json` and a first video, or ask Claude: "here are my stems and the vizier repo; take a first pass
   at the project". `pnpm validate projects/<id>` checks the result.
4. Refine by rendering stills (`--still-bar`) and short excerpts (`--bars`), and soon in the editor.

The JSON Schemas in `packages/core/schema/` describe both files; editors such as VS Code use them for
completion and checking via the `$schema` line at the top of each file.
