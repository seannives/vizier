# The editor

```sh
vizier editor projects/<song> [--video <video>] [--port 5174]
```

Chrome opens the editor in a window of its own (no tabs or address bar) at **http://localhost:5174** (add `?previewScale=0.25` for a smaller, cheaper preview on a slow machine). The editor reads and writes the project's files; nothing is
uploaded anywhere. Stop it with Ctrl+C in Terminal.

`--no-open` skips opening Chrome (for example when the editor window is already open). If you quit with Ctrl+C while the
browser has unsaved changes, the editor reminds you how to restart it; the changes stay in the open window. While the
server isn't running, the editor says so and keeps your changes: start it again and save.

## What it does

- **Video menu** (top left): every video in the project; videos built on another show `← base`. Switching keeps
  unsaved changes to all videos; Save writes every changed file.
- **Transport, Ableton-style**: Play starts from the start marker (the hollow triangle in the ruler). Stop leaves the
  playhead where it stopped; the next Play jumps back to the marker, and ⇧Space continues from the stop point instead.
  Clicking the timeline or the arrow keys move the marker. With loop on (L), playback wraps at the range's end.
- **Preview**: the open video in its format, at reduced resolution, with the safe area for vertical formats.
- **Timeline**: bar ruler, sections, and a waveform per track (each scaled to its own peak), with each track's layers
  under it. The ruler and sections stay put; swipe up and down over the tracks to scroll them, sideways to move
  along the song. Click or drag to move the playhead; zoom with ⌘ + two-finger swipe (up = in, as in Ableton) or
  pinch.
- **Range**: drag in the bar ruler to set the video's range; drag its ends to adjust, or the bar to move it. The
  side panel shows it in bars and in minutes:seconds. A faint bar means the range is inherited from the base video.
- **Preview**: shows whole frames at the video's frame rate (30 fps for most formats), as the export will.
- **Frame timing** (I): shows the display rate, the share of late frames and what a preview frame costs, for
  diagnosing a jerky playhead.
- **Snap** (top bar, ⌘4): clicks and scrubbing on the timeline, and ranges, snap to beats, whether dragged or set with [ and ]. Hold ⇧ while dragging to do the
  opposite of the current setting.
- **Sync** (status bar): lines the playhead and picture up with what you hear. If the sound comes after the playhead,
  press +; if it comes before, press −. It's remembered per browser (so set it once per speakers or headphones).
- **Save, undo, redo**: ⌘S, ⌘Z, ⇧⌘Z. Changes aren't written until you save; the Save button and the status bar
  show unsaved files, and Chrome warns before closing with unsaved changes.

### Layers

- **Layer list** (side panel, front first): click to select; double-click a name to rename; ↑ ↓ move a layer in
  front of or behind its neighbour; ⧉ duplicates (⌘D; the copy goes just behind); ✕ removes. **+ Add layer…** adds one on top, full frame.
- **Layer panel** (below the list, for the selected layer): what draws it, its track and blend mode; text for text
  layers; every parameter as a slider with a number you can type into (typed values may go past the slider's range;
  double-click a parameter to reset it to its default); the effect chain (add, reorder, remove, and each effect's
  parameters). Parameters with an automation lane show in amber: the lane sets them while playing.
- **When a layer is on**: each layer has a row under its track in the timeline. A full faint bar means it's on for
  the whole song; amber blocks are its spans. Drag in an empty part of the row to make a span, drag a span's ends
  or body to change it (snap applies), click a span and press Delete to remove it, and ⌘E splits the selected
  layer at the playhead. The panel's **On** section shows the spans in bars with fades in beats, and has
  **Split at playhead**, **On from playhead** and **Whole song**.
- Edits apply to the preview at once, without restarting trails. Dragging a slider is one undo step.
- **In a video built on another**, edits go to the open video only, as overrides; the base is never changed. A
  layer from the base is marked "from base". Changing an inherited layer's generator replaces it with a new layer
  (same name, track, depth, layout and spans), because the base's settings wouldn't fit the new generator.

Layout on the preview (drag and resize layers) comes next, then inherited markers, reset and video actions;
automation lanes in milestone 3, tracks and tempo in 4, colour and render in 5 (see the [roadmap](roadmap.md)).

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
| ⌘E | split the selected layer at the playhead |
| Delete | remove the selected on-span |
| ⌘D | duplicate the selected layer |
| + / − / 0 | zoom in / out / fit the song |
| ⌘Z / ⇧⌘Z | undo / redo |
| ⌘S | save |
