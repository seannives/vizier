# 8. Colour

Status: accepted (2026-11-16)

**Decisions.**
- **A palette of five slots** per song (videos may override): background, ink, accent, and two more for secondary
  colours. Today's `acid` becomes `accent`.
- **Layers follow palette slots by default; any layer can take its own colour** (option C). Each generator declares
  its colour parameters (e.g. the ring's line and highlight), each defaulting to a slot. Changing a palette slot
  moves every layer that follows it; a layer can break away with its own colour.
- **Colour automation uses colour breakpoints**: each point on a colour lane is a whole colour; the renderer blends
  between them in **OKLCH**, so fades keep even brightness and vividness instead of going muddy. Palette slots and
  layer colours are both automatable.
- **Two modulation targets per layer: hue shift and brightness**, so audio can rotate or pulse a layer's colour.
- **Test early:** built before the editor UI and tried in real renders, in case separate hue / brightness /
  saturation lanes turn out to be needed.
