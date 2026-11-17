# The editor

```sh
pnpm edit projects/<song> [--video <video>] [--port 5174]
```

Then open **http://localhost:5174** in Chrome (add `?previewScale=0.25` for a smaller, cheaper preview on a slow machine). The editor reads and writes the project's files; nothing is
uploaded anywhere. Stop it with Ctrl+C in Terminal.

## Milestone 1 (now)

- **Video menu** (top left): every video in the project; videos built on another show `← base`. Switching keeps
  unsaved changes to all videos; Save writes every changed file.
- **Preview**: the open video in its format, at reduced resolution, with the safe area for vertical formats.
- **Timeline**: bar ruler, sections, and a waveform per track (each scaled to its own peak). Click or drag to move
  the playhead; scroll sideways with the trackpad; pinch, or ⌘-scroll, to zoom.
- **Range**: drag in the bar ruler to set the video's range; drag its ends to adjust, or the bar to move it. It snaps
  to beats (hold ⇧ to turn snapping off). A faint bar means the range is inherited from the base video.
- **Save, undo, redo**: ⌘S, ⌘Z, ⇧⌘Z. Changes aren't written until you save; the Save button and the status bar
  show unsaved files, and Chrome warns before closing with unsaved changes.

Layers, parameters and layout come in milestone 2, automation lanes in 3, tracks and tempo in 4, colour and
render in 5 (see the [roadmap](roadmap.md)).

## Keyboard

Press **?** in the editor for the full list.

| Keys | |
|---|---|
| Space | play / stop |
| L | loop the range |
| ← / → | back / forward a bar (⇧: a beat) |
| Home | go to the range start (or the song start) |
| [ / ] | range starts / ends at the playhead |
| ⇧⌫ | clear the range (whole song) |
| + / − / 0 | zoom in / out / fit the song |
| ⌘Z / ⇧⌘Z | undo / redo |
| ⌘S | save |
