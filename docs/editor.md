# The editor

```sh
vizier editor projects/<song> [--video <video>] [--port 5174]
```

Chrome opens on the editor at **http://localhost:5174** (add `?previewScale=0.25` for a smaller, cheaper preview on a slow machine). The editor reads and writes the project's files; nothing is
uploaded anywhere. Stop it with Ctrl+C in Terminal.

`--no-open` skips opening Chrome (for example when the tab is already open). If you quit with Ctrl+C while the
browser has unsaved changes, the editor reminds you how to restart it; the changes stay in the open tab. While the
server isn't running, the editor says so and keeps your changes: start it again and save.

## Milestone 1 (now)

- **Video menu** (top left): every video in the project; videos built on another show `← base`. Switching keeps
  unsaved changes to all videos; Save writes every changed file.
- **Transport, Ableton-style**: Play starts from the start marker (the hollow triangle in the ruler). Stop leaves the
  playhead where it stopped; the next Play jumps back to the marker, and ⇧Space continues from the stop point instead.
  Clicking the timeline or the arrow keys move the marker. With loop on (L), playback wraps at the range's end.
- **Preview**: the open video in its format, at reduced resolution, with the safe area for vertical formats.
- **Timeline**: bar ruler, sections, and a waveform per track (each scaled to its own peak). Click or drag to move
  the playhead; scroll sideways with two fingers; zoom with ⌘ + two-finger swipe (up = in, as in Ableton) or pinch.
- **Range**: drag in the bar ruler to set the video's range; drag its ends to adjust, or the bar to move it. The
  side panel shows it in bars and in minutes:seconds. A faint bar means the range is inherited from the base video.
- **Snap** (top bar, ⌘4): ranges snap to beats, whether dragged or set with [ and ]. Hold ⇧ while dragging to do the
  opposite of the current setting.
- **Sync** (status bar): lines the playhead and picture up with what you hear. If the sound comes after the playhead,
  press +; if it comes before, press −. It's remembered per browser (so set it once per speakers or headphones).
- **Save, undo, redo**: ⌘S, ⌘Z, ⇧⌘Z. Changes aren't written until you save; the Save button and the status bar
  show unsaved files, and Chrome warns before closing with unsaved changes.

Layers, parameters and layout come in milestone 2, automation lanes in 3, tracks and tempo in 4, colour and
render in 5 (see the [roadmap](roadmap.md)).

## Keyboard

Press **?** in the editor for the full list.

| Keys | |
|---|---|
| Space | play (from the start marker) / stop (where it is) |
| ⇧Space | continue from where playback stopped |
| L | loop the range |
| ← / → | back / forward a bar (⇧: a beat) |
| Return (or fn←) | go to the range start (or the song start) |
| [ / ] | range starts / ends at the playhead |
| ⇧⌫ | clear the range (whole song) |
| ⌘4 | snap to the beat on / off |
| + / − / 0 | zoom in / out / fit the song |
| ⌘Z / ⇧⌘Z | undo / redo |
| ⌘S | save |
