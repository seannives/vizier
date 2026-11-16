# 6. Project structure: songs, videos, beat grid

Status: accepted (2026-11-16), to be implemented in Phase 2

**Context.** One song gets several videos (a full YouTube video, several Reels/Shorts of different bars with
different text). Exports often start before the first downbeat (a "breath" for streaming services). The editor
will be the main way to work; hand-editing JSON should be rare.

**Decisions.**
- `projects/<id>/` per song; `projects/` is ignored by vizier's git except a generated-audio demo. A user's own
  projects can be a private git repo of their own.
- `song.json`: tracks (stems, with fixed IDs and display names, one marked as the mix), tempo list, beat-grid
  anchor, sections, palette. `videos/<name>.json`: formats, bar range, layers, text, automation, modulations.
  A video may build on another (`base`) and override or add to it, so the look is maintained in one place.
- Bars are vizier's own grid: tempo + a downbeat position in the audio (seconds). Bar 1 is the first downbeat
  of the music; audio before it (lead-in) is bar 0.x. An optional label offset can number bars like Live's
  arrangement, which may matter for live sync later. The editor shows the grid over each track's waveform,
  with an optional click, so alignment can be checked by eye and ear.
- Automation and text cards are placed in song bars (seconds also allowed), so a Reel built on the full video
  shows the same thing at the same musical moment.
- Renders go to the project's `output/`, overwritten by default, timestamped with `--keep`; each render writes a
  snapshot of the merged song + video settings next to it.
- No dependency on Ableton's Extensions SDK.
