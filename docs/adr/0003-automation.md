# 3. Parameter stack and automation

Status: accepted (2026-11-14)

Every visual control is a named parameter `layer.param`. Its value at time t is
`base → automation lane → + Σ audio modulations → live override (wins)`.

Lanes are breakpoint lists (linear / hold / smooth), stored as text in the project so git diffs them.
Live performance moves are recorded as timestamped events and thinned to breakpoints (`thinRecording`),
so a performance becomes editable automation and re-renders exactly.

Breakpoints and sections can be placed in bars (`bar`, 1-based, fractional) using the project's `tempo`, or in
seconds (`t`). Bars are converted to seconds on load, so the renderer only ever sees seconds.

**Next.** A full tempo map (from a Live export) behind the same `bar` syntax; importing MIDI CC lanes from a control track.
