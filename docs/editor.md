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

- **Projects**: click the project's name (top left) to open another project in `projects/` or make a new one
  (a title and its audio; see [projects.md](projects.md#starting-a-new-project)). Started without a project
  (`vizier editor`), the editor opens on the same page.
- **Video menu** (top left): every video in the project; videos built on another show `← base`. Switching keeps
  unsaved changes to all videos; Save writes every changed file. **+ New** makes a video that builds on the open
  one, an independent copy of it, or a blank one, in any format; **Duplicate** is a quick copy. A new video is
  written to `videos/<name>.json` when you save.
- **Video** (side panel): the open video's name, format, what it builds on (click the name to open the base;
  **Detach** copies everything it inherits into it, so it looks the same but no longer follows the base) and its
  range.
- **Tracks** (side panel, fold open with ▸): the song's audio, shared by every video. Drag audio files from
  Finder anywhere onto the editor to add tracks (named after the file), or onto a track (its row in the panel or
  its name in the timeline) to replace its audio with a new bounce; **+ Add from media/** and **Replace…** use
  files already in the project's `media/` folder. Rename a track by typing its name (layers and modulations refer
  to its id, which doesn't change); ↑ ↓ reorder; ✕ removes it, and layers that listened to it listen to the mix
  (the mix itself can't be removed, only replaced). Each stem is checked against the mix: a warning says if it's
  shorter or longer, or starts early or late (bounce stems from the same start as the mix), or that it couldn't
  tell (a stem with little in common with the mix, or a whole bar out), so listen to check. **OK** hides a warning
  you've checked; it comes back if the track gets a new file. A dropped
  file is kept aside until you save: saving moves it into `media/` under its own name, overwriting the file the
  track used if it had the same name, or deleting the old file if nothing else uses it. Undo before saving
  leaves `media/` as it was. A removed track's file stays in `media/`.
- **Tempo** (side panel, fold open with ▸): the song's grid, shared by every video. **Bar 1 starts at** is where
  bar 1 begins in the mix (◂ ▸ slide the grid 10 ms, ⇧ for 1 ms). **Bar line to playhead**: put the playhead on a
  downbeat you can hear or see, press it, and the nearest bar line moves there. The table sets the BPM and beats per
  bar, from bar 1 and from any later bar (**+ Change at bar N** adds one at the playhead's bar; the ruler marks
  changes). **From the mix** offers the tempo worked out from the mix (and other likely ones: half and double
  tempos are common mix-ups) and where bar 1 starts; click one to use it. **⌥-drag in the bar ruler** slides the
  whole grid. **Click** (C, also in the top bar) ticks on every beat while playing, higher on the first beat of each
  bar, to check the grid by ear. Layers, lanes and ranges are in bars, so they move with the grid.
- **Palette** (side panel, fold open with ▸): the five colour slots layers follow (background, ink, accent,
  extra 1 and 2). Click a swatch to change it: the song's palette changes for every video, unless **Only in this
  video** is ticked in the picker (marked "this video", ↺ to go back; "base" when a base video sets it). **A**
  starts a colour lane for the slot at the playhead.
- **Colours** (layer panel): each of the layer's colours follows a palette slot (shown by name) or is its own
  (shown as #RRGGBB). In the picker, the palette swatches make it follow that slot; the hex field, sliders or
  eyedropper give it its own colour. **A** starts a colour lane for it.
- **The colour picker**: the palette's swatches, a hex field (Return to apply), an eyedropper (anywhere on the
  screen), and sliders for lightness, vividness and hue: they change the colour the way it looks (in OKLCH), and
  each slider's track shows what it would do. Esc or a click outside closes it; a slider drag is one undo step.
- **Colour lanes** (in the timeline, under their layer; the palette's, film grain and vignette under **Palette &
  picture** at the top): a strip of the colour over time, with each breakpoint as a swatch. Click to add a
  breakpoint (it takes the colour already there), drag to move it, double-click it (or click the swatch in the
  lane's header) to pick its colour, Delete to remove it, and the curve buttons as for other lanes. Fades blend in
  OKLCH, so they stay bright and vivid; **Fade the long way round** (in the picker, for the fade after that point)
  goes the other way round the colour wheel: green to red through blue and purple instead of yellow. ↻ marks it.
- **Transport, Ableton-style**: Play starts from the start marker (the hollow triangle in the ruler). Stop leaves the
  playhead where it stopped; the next Play jumps back to the marker, and ⇧Space continues from the stop point instead.
  Clicking the timeline or the arrow keys move the marker. With loop on (L), playback wraps at the range's end
  when it gets there; started after the range, it plays on, as in Ableton.
- **Preview**: the open video in its format, with the safe area for vertical formats. **Quality** (the menu under
  the picture) sets how sharp it is: Auto draws at most 960 pixels across (half size for 1080p), Full draws
  exactly what the export will. Positions, sizes, line widths and glow look the same at any quality; only fine
  detail is softer. The editor's preview and the popped-out window each remember their own choice (Full suits a
  projector).
- **Pop out** (top right of the preview): the preview moves to its own window, for a second screen or a
  projector. The editor then splits its side panel in two (video and layers on the left, the selected layer on the
  right) and gives the timeline more height. The output window follows the playhead and the open video; its
  layout handles edit the editor's video; keys pressed there go to the editor (Space, ⌘Z…). **F** toggles full
  screen there (Esc leaves it), without handles. Close the window, or **Bring it back** in the editor, to return.
  If Chrome blocks the window, allow pop-ups for the editor's page.
- **Timeline**: bar ruler, sections, and a waveform per track (each scaled to its own peak), with each track's layers
  under it. The ruler and sections stay put; swipe up and down over the tracks to scroll them, sideways to move
  along the song. Click or drag to move the playhead; zoom with ⌘ + two-finger swipe (up = in, as in Ableton) or
  pinch. Drag the **grip** on the timeline's top edge to make it taller or shorter (remembered, separately for
  the preview in the editor and popped out); double-click it to fit the rows exactly. With the preview popped out,
  the timeline starts just tall enough for its rows.
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
- The side panel widens (up to 600 px) into room the preview doesn't use; the selected layer's name stays at the top
  of its panel while it scrolls.
- **Layer panel** (below the list, for the selected layer; what every parameter does: [visuals.md](visuals.md)): what draws it, its track and blend mode; text for text
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

### Automation lanes

- A layer with automation has an **▸** in front of its row in the timeline: click it to show all its lanes (one
  per automated parameter, its effects' included), or hide them. The line shows the value over the song. A lane's
  **–** hides just that lane; hidden lanes keep working.
- **Click** in a lane to add a breakpoint there (time snapped to the beat unless ⇧); **drag** a breakpoint to move
  it (it can't pass its neighbours); **click** one to select it, and **Delete** removes it (removing the last one
  removes the lane).
- The lane's header sets the **curve** after the selected breakpoint: ⟋ straight, ⌐ hold then jump, ∿ ease in
  and out. ✕ removes the lane.
- **A** next to a parameter in the layer panel starts a lane at the playhead with the current value and shows it;
  on an automated parameter it shows or hides the lane, and it's highlighted while the lane is shown. Automated
  parameters say **- automated** after their name: the lane sets the value while playing, and the slider only
  where no lane does.
- In a video built on another, inherited lanes are tagged **base**; editing one makes it this video's own
  (**changed**, with ↺ to go back to the base's); ✕ removes it here only.
- Breakpoints are saved in bars, so they stay on the music if the tempo changes.

### Audio modulation

The music can move any parameter: **value = slider (or automation lane) + amount × feature**, every frame. A
feature is a measurement of a track from 0 to 1, such as its loudness, low end or brightness (they're listed with
what they're good for in [visuals.md](visuals.md#what-the-visuals-listen-to)).

- **M** next to a parameter adds a modulation (the layer's own track, its smoothed loudness, a quarter of the
  parameter's range) and shows it under the parameter; on a modulated parameter, M shows or hides its
  modulations (highlighted while shown). Modulated parameters say **- modulated** after their name.
- Each modulation has the **track** (any stem, or the mix), the **feature**, the **amount** (how far it can move
  the value at full level; negative moves it down; double-click the slider for 0) and the **curve**: linear (in
  proportion), peaks (only strong peaks move it much) or gentle (even quiet parts move it noticeably).
- The **meter** shows the feature's level at the playhead and what it adds to the parameter right now, so you can
  set the amount while the song plays.
- **+ another** adds a second track or feature (they add up); ✕ removes one.
- Modulation stacks with automation: the lane sets where the value sits over the song, the music moves it around
  that. In a video built on another, modulations are inherited (base), changed here (↺ back) or removed here only.

### Layout on the preview

- **Click a layer on the preview** to select it (only layers that are on at the playhead). Where layers overlap,
  click again to select the next one down.
- **Drag** the selected layer to move it; drag a **corner or edge handle** to resize it (the opposite side stays
  put; hold ⌥ to resize about the centre); drag the **knob** on top to rotate it (in 15° steps; ⇧ for any angle).
- **Snapping**: edges and centres snap to the frame's edges and centre, and to the safe area's for Reels (a dashed
  pink line shows what it snapped to). Hold ⇧ to place freely. A rotated layer snaps its centre only.
- **Each shape of format has its own layout**: landscape (YouTube), portrait (Shorts, Reels) and feed (Instagram
  feed). A layer without a portrait layout borrows the landscape one until you change it in a portrait video.
- The panel's **Layout** section shows the same numbers (position and size in % of the frame, rotation in degrees)
  to type into, with **Fill frame** and **Centre**. A layer bigger than the frame has handles off the preview;
  type its size there.
- A drag is one undo step.

### Videos that build on others

In a video with a base (a Reel built on the full video), the layer list tags each layer: **base** (inherited,
unchanged), **changed** (inherited, changed here) or **added** (only in this video). In the layer panel, every
setting this video changes has a dot and a **↺** that takes it back to the base's value (hover it to see that
value); **Reset layer to base** drops all of this video's changes to the layer. Format and range have a ↺ too.
A base layer removed here is listed under the layers with **Restore**, which also brings back its automation.
Changes always go to the open video; to change the base, open it.

Next: a bug sweep, then tracks and tempo in milestone 4,
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
| ⌘D | duplicate the selected layer |
| Delete | remove the selected breakpoint (or on-span) |
| + / − / 0 | zoom in / out / fit the song |
| ⌘Z / ⇧⌘Z | undo / redo |
| ⌘S | save |
