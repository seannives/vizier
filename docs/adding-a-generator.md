# Adding a generator or an effect

Visuals are plugins. Each lives in its own folder and declares its parameters; the renderer, validation,
automation and (soon) the editor's controls all work from those declarations.

## A generator

1. Create `packages/core/src/generators/<id>/index.ts` that default-exports `defineGenerator({...})`.
2. Add one import line to `packages/core/src/generators/index.ts`.
3. Use it in a project: `{ "id": "mylayer", "generator": "<id>", "stem": "drums", ... }`.

Every generator has `id`, `label`, `description`, `params` and a `kind`:

```ts
params: [
  { name: "scale", label: "Scale", min: 0.5, max: 8, default: 2.5 },
  { name: "rows", label: "Rows", type: "int", min: 4, max: 80, default: 36 },
  { name: "fill", label: "Fill", type: "toggle", min: 0, max: 1, default: 1 },
]
```

`min`/`max` are the range the editor offers; audio modulation can push a value beyond it, so clamp inside the
generator if a value must stay in range. A parameter can be automated as `<layer>.<name>`.

### Canvas 2D (`kind: "canvas2d"`)

`draw(g)` paints into `g.ctx`, a `w`×`h` canvas the size of the layer. See `acidRing` and `ridgeline`.

| | |
|---|---|
| `g.p("name")` | the parameter's current value (base → automation → modulation → live override) |
| `g.f("env", framesAgo?, stem?)` | a feature of the layer's stem: `rms env low lowMid mid high centroid flux onset hit` |
| `g.spectrum(framesAgo?, stem?)` | 32 log-spaced bands, 0–1 |
| `g.t`, `g.frame`, `g.fps` | time in seconds, frame number, frame rate |
| `g.rng()` | seeded random numbers: never use `Math.random()` |
| `g.palette`, `g.text`, `g.font` | project colours (`bg`, `ink`, `acid`), the layer's text, the font |

Look back with `framesAgo` rather than keeping state between frames: a frame must be drawable on its own.

### GLSL (`kind: "shader"`)

`fragment` is the body of `vec4 generate(vec2 uv)`, returning premultiplied RGBA. See `flowField`.
`uv` runs 0–1 with y up. Available: `u_res`, `u_aspect`, `u_time`, `u_frame`, `u_seed`; the features
`u_rms u_env u_low u_lowMid u_mid u_high u_centroid u_flux u_onset u_hit`; `spec(bin01, framesAgo01)`
for the last 64 frames of spectrum; colours `u_inkColor u_acidColor u_bgColor`; each parameter as
`u_<name>`; helpers `hash21`, `noise`, `fbm`.

## An effect

Create `packages/core/src/effects/<id>/index.ts` exporting `defineEffect({...})` and add it to
`packages/core/src/effects/index.ts`. An effect is one or more GLSL `passes`, each the body of
`vec4 pass(vec2 uv)`: `u_in` is the previous pass, `u_orig` the effect's input, `u_texel` one pixel,
`u_fps` the frame rate, each parameter `u_<name>`. With `feedback: true`, `u_fb` is the effect's own output
from the previous frame (see `trails`). Write anything time-based per second, using `u_fps`, so it looks the same at
30 fps (video) and 60 fps (live).

Layers list effects in order: `"effects": [{ "type": "glow", "params": { "amount": 0.8 } }]`. Effect
parameters are automated as `<layer>.<effect id>.<param>`; the id is the type unless you give one.

Feedback effects depend on earlier frames. When rendering starts mid-song (excerpts, seeking live), the
renderer first renders a few seconds of lead-in, so the frame matches the same moment in a full render.

## Checklist

- `pnpm test`: the plugin test checks every parameter declaration (unique names, `min ≤ default ≤ max`).
- Render a still at a busy moment and a quiet one: `pnpm render <project> --still <frame> --gpu`.
- `pnpm render <project> --bench 300 --gpu` to check the cost per frame.
