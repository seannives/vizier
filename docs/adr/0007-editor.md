# 7. The editor

Status: accepted (2026-11-16), to be built in Phase 3

**Context.** Hand-editing project files must become rare. The editor has to fit a 14" MacBook screen, feel like
a music tool, and later grow into a way to *play* the visuals live.

**Decisions.**
- **A local web app** (`pnpm edit <project>`), served by a small local server that reads and writes the project
  folder (and copies stems into `media/`). Opened in Chrome. Not a desktop app for now.
- **One shared session, several views.** The project data and undo history live in plain TypeScript, outside the
  UI framework. The editor and any output window (projector, second monitor) are views of the same session,
  kept in sync through the local server; edits apply to a running renderer immediately, without a rebuild.
  This is what later allows performing: controls (keys, MIDI, Push 3) mapped to parameters as live overrides,
  recorded as automation.
- **Svelte 5 + TypeScript** for the panels; the timeline, waveforms, automation lanes and preview are drawn on
  canvases.
- **Videos that build on others:** edits always go to the open video. Inherited settings are marked; changing one
  makes it the video's own; "reset to inherited" reverts it; "Open base" switches to the base. Actions: New video,
  Duplicate (independent copy), Detach from base.
- **One format per video.** A video file has one `format` (replacing `profiles`); Render renders that. Reels and
  Shorts are separate videos (one can build on the other). The command line keeps `--profile` for tests.
- **Explicit save** (⌘S, unsaved marker, warning on close) and **undo/redo** (⌘Z / ⇧⌘Z) from the first version.
- **Keyboard first, Ableton-like:** space play/stop, ⌘Z/⇧⌘Z, ⌘S, ⌘D duplicate, Delete, arrows nudge (shift: more),
  +/− zoom, `?` lists shortcuts. One shortcut table (later also MIDI mappings). Avoid ⌘W/⌘T/⌘N/⌘Q, which Chrome keeps.
- **Preview** uses the live renderer at reduced resolution, in the video's format, with its safe areas.
- **Timeline:** whole song always visible; bar ruler, sections, per-track waveforms, beat grid (optional click);
  the video's range is a draggable bracket on the ruler. One automation lane per parameter; snapping to the beat;
  add/drag/delete breakpoints and curve types (pencil drawing later).
- **Look:** dark, dense, Ableton-like, with some character. IBM Plex Sans Condensed + IBM Plex Mono (to be compared
  on screen with Space Grotesk + JetBrains Mono). Neutral dark greys, one amber accent (configurable).
- **Milestones:** (1) open, play, timeline + preview; (2) layers, parameters, layout; (3) automation lanes;
  (4) tracks/stems and tempo panel; (5) colour UI and Render.
