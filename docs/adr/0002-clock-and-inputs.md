# 2. Inputs are swappable; nothing requires Ableton

Status: accepted (2026-11-14)

**Decision.** The renderer consumes three abstract inputs:
- **audio features** per stem (offline: from files; live: from audio device channels, any source);
- **clock**: offline timeline, MIDI clock + Song Position Pointer (Live sends SPP in "Song" mode), Ableton Link
  (via a small Node bridge, if needed), internal/tap tempo, or none (audio only);
- **control events**: score JSON, MIDI controllers (Push 3), keyboard.

The renderer owns arrangement state; sources only send events. Ableton-specific import (arrangement export) is an
optional adapter kept out of this public repo.

**Open.** Chrome's getUserMedia has historically been capped at 2 input channels (unverified for current Chrome).
First live test: several stereo BlackHole devices at once. Fallback: a Node bridge reading a multichannel device and
running the same feature code, streaming features over WebSocket.
