# 9. When a layer is on; edits applied in place

Status: accepted (2026-11-17)

**Context.** A track's visuals often change at an arrangement point: the 303 drives an acid ring up to the drop and
a dot grid after it. Opacity automation with a hold step can do that, but it takes two lanes to say one thing, and
a layer at zero opacity with trails is still drawn (so the trails can fade), which costs time. Separately, the
editor's preview rebuilt its renderer for every edit, which restarted trails and would make sliders sluggish.

**Decisions.**
- **On-spans per layer** (`spans`): bars where the layer is on (`to` exclusive and optional), with optional fades in
  beats inside the span. No spans, or an empty list: on for the whole song. Outside its spans a layer isn't drawn at
  all; its feedback buffers are cleared when it comes back on, so trails start fresh. A video built on another
  replaces a layer's spans as a whole.
- In the editor, spans are blocks on a row under the layer's track, like clips in Ableton's Arrangement View: drag
  to make, move and resize; ⌘E splits at the playhead; Delete removes. A layer that's on for the whole song splits
  into two spans, the first from the song's first moment (before bar 1 when the downbeat isn't at 0 s).
- **Edits apply to the running renderer** (`Renderer.update`): a layer whose generator, pixel size and effect chain
  are unchanged keeps its GPU state; parameters, colours, text, spans, order and automation take effect at once.
  New or structurally changed layers are built fresh. The preview's renderer is rebuilt only when the format,
  preview size or audio analysis changes. After an edit while paused, the frame is redrawn at once, then once more
  with a proper lead-in when the edits pause, so it matches the export.
- **Edits always go to the open video** (ADR 0007). Changing an inherited layer's generator replaces it with a new
  layer, since the base's parameters wouldn't fit.
- **Undo merges slider drags**: changes with the same merge key in a row are one step until the slider is let go.
