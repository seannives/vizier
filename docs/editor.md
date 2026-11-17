# The editor

```sh
pnpm editor projects/<song> [--video <video>] [--port 5174]
```

(Any script also runs as `pnpm run <name>`, which always uses the project's own script even if pnpm has a command
of the same name.) Then open **http://localhost:5174** in Chrome (add `?previewScale=0.25` for a smaller, cheaper preview on a slow machine). The editor reads and writes the project's files; nothing is
uploaded anywhere. Stop it with Ctrl+C in Terminal.

It opens Chrome on the editor by itself once it's ready (`--no-open` turns that off). If you quit with Ctrl+C while
the browser has unsaved changes, it warns you and waits for a second Ctrl+C. If the server isn't running, the
editor says so and keeps your changes: start it again and save.

## Milestone 1 (now)

- **Video menu** (top left): every video in the project; videos built on another show `← base`. Switching keeps
  unsaved changes to all videos; Save writes every changed file.
- **Transport, Ableton-style**: Play starts from the start marker (the hollow triangle in the ruler) and Stop returns
  there. Clicking the timeline or the arrow keys move the marker. ⇧Space continues from where playback stopped.
  With loop on (L), playback wraps at the range's end.
- **Preview**: the open video in its format, at reduced resolution, with the safe area for vertical formats.
- **Timeline**: bar ruler, sections, and a waveform per track (each scaled to its own peak). Click or drag to move
  the playhead; scroll sideways with two fingers; zoom with ⌘ + two-finger swipe (up = in, as in Ableton) or pinch.
- **Range**: drag in the bar ruler to set the video's range; drag its ends to adjust, or the bar to move it. The
  side panel shows it in bars and in minutes:seconds. A faint bar means the range is inherited from the base video.
- **Snap** (top bar, ⌘4): ranges snap to beats, whether dragged or set with [ and ]. Hold ⇧ while dragging to do the
  opposite of the current setting.
- **Audio delay** (status bar): if the sound comes after the playhead (Bluetooth headphones add 150–250 ms), raise it
  until they line up. It's remembered per browser.
- **Save, undo, redo**: ⌘S, ⌘Z, ⇧⌘Z. Changes aren't written until you save; the Save button and the status bar
  show unsaved files, and Chrome warns before closing with unsaved changes.
- **Font comparison**: the button at the bottom right switches the interface between IBM Plex and Space Grotesk +
  JetBrains Mono.

Layers, parameters and layout come in milestone 2, automation lanes in 3, tracks and tempo in 4, colour and
render in 5 (see the [roadmap](roadmap.md)).

## Keyboard

Press **?** in the editor for the full list.

| Keys | |
|---|---|
| Space | play / stop (stop returns to the start marker) |
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
