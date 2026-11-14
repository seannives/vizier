# 1. TypeScript, browser rendering, one renderer for offline and live

Status: accepted (2026-11-14)

**Context.** Visuals must work as music videos (offline, frame-exact) and live (real time on an M1 Pro, projector).
Most development and testing must run in a Linux sandbox without Ableton, Max or a GPU.

**Decision.** TypeScript everywhere. Rendering in the browser: each layer draws with Canvas 2D (D3 for scales and
shapes) into its own texture; a WebGL2 compositor places layers (position, size, rotation, z, opacity, blend) and
applies post effects. Offline, headless Chrome steps the renderer frame by frame and pipes pixels to ffmpeg. Live, the
same bundle runs fullscreen in Chrome.

**Consequences.** Frames are a pure function of (project, frame number, features); a test checks byte-identical
re-renders. Pixels differ between software GL and a Mac GPU, so golden images are per machine. Heavy generators can
move from Canvas 2D to shaders later without changing the project format. SVG layers remain possible (SVG → texture).
