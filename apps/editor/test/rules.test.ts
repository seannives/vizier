// Bug sweep: rule-based tests. Random sequences of edits (every editing operation the editor has, on random
// layers, parameters, lanes, modulations and videos) are applied to the demo project; after every edit, rules that
// must always hold are checked. When a rule breaks, fast-check shrinks the sequence to the shortest that breaks it.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AjvModule from "ajv";
import { Session, type Doc } from "../src/app/lib/session.ts";
import * as E from "../src/app/lib/edits.ts";
import {
  GENERATORS, EFFECTS, PROFILES, buildProject, resolveVideo, validateProject, laneToSeconds, isColorLane, spansToSeconds, ParamResolver,
  secondsToBar, type LayerDef, type LayoutFamily,
} from "../../../packages/core/src/index.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p: string) => JSON.parse(readFileSync(root + p, "utf8"));
const Ajv = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as new (o: object) => import("ajv").default;
const ajv = new Ajv({ allErrors: true });
const videoSchema = ajv.compile(read("packages/core/schema/video.schema.json"));
const start = (): Doc => ({ song: read("projects/demo/song.json"), videos: { full: read("projects/demo/videos/full.json"), reel: read("projects/demo/videos/reel.json") } });

// The same sequences every run (so a failure on GitHub is the one you see locally). To look for new ones:
// VIZIER_FUZZ_SEED=random pnpm test (or a number, to replay a seed a failure printed).
const SEED = process.env.VIZIER_FUZZ_SEED === "random" ? Date.now() % 2 ** 31 : Number(process.env.VIZIER_FUZZ_SEED ?? 20261118);
const fuzz = (runs: number) => ({ numRuns: runs, seed: SEED });

const GENS = Object.keys(GENERATORS), FXS = Object.keys(EFFECTS), FORMATS = Object.keys(PROFILES).filter((p) => !p.startsWith("live"));
const FAMILIES: LayoutFamily[] = ["landscape", "portrait", "feed"];
const FEATURES = ["env", "rms", "low", "lowMid", "mid", "high", "centroid", "flux", "hit", "onset"];

/** One random step: numbers that pick an operation and its arguments from the project as it is. */
type Step = { op: number; a: number; b: number; x: number; y: number };
const step = fc.record({ op: fc.nat(), a: fc.nat(), b: fc.nat(), x: fc.double({ min: 0, max: 1, noNaN: true }), y: fc.double({ min: 0, max: 1, noNaN: true }) });

const pick = <T,>(xs: readonly T[], n: number): T | undefined => (xs.length ? xs[n % xs.length] : undefined);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Every parameter target of a layer (its own and its effects'), with its range. */
function targetsOf(l: LayerDef): { target: string; min: number; max: number; int: boolean }[] {
  const out: { target: string; min: number; max: number; int: boolean }[] = [];
  for (const s of [...E.PANEL_LAYER_PARAMS, ...(GENERATORS[l.generator]?.params ?? [])]) out.push({ target: `${l.id}.${s.name}`, min: s.min, max: s.max, int: s.type === "int" || s.type === "toggle" });
  for (const e of l.effects ?? []) for (const s of EFFECTS[e.type]?.params ?? []) out.push({ target: `${l.id}.${e.id ?? e.type}.${s.name}`, min: s.min, max: s.max, int: false });
  return out;
}

/** Apply one random edit through the session (as the editor does). Returns a label for the failure report. */
function apply(s: Session, st: Step): string {
  const doc = s.doc;
  const videos = Object.keys(doc.videos);
  const v = pick(videos, st.a)!;
  const layers = E.layersOf(doc, v);
  const l = pick(layers, st.b);
  const grid = doc.song.grid!;
  const bar = round3(1 + st.x * 33);
  const t = l ? pick(targetsOf(l), st.a >> 3) : undefined;
  const value = t ? (t.int ? Math.round(t.min + st.y * (t.max - t.min)) : round3(t.min + st.y * (t.max - t.min))) : 0;
  const ops: [string, (d: Doc) => unknown][] = [
    ["addLayer", (d) => E.addLayer(d, v, pick(GENS, st.b)!, pick(doc.song.tracks, st.a)!.id)],
    ["removeLayer", (d) => l && E.removeLayer(d, v, l.id)],
    ["moveLayer", (d) => l && E.moveLayer(d, v, l.id, st.x < 0.5 ? -1 : 1)],
    ["duplicateLayer", (d) => l && E.duplicateLayer(d, v, l.id)],
    ["setParam", (d) => l && t && !t.target.slice(l.id.length + 1).includes(".") && E.setParam(d, v, l.id, t.target.slice(l.id.length + 1), value)],
    ["setGenerator", (d) => l && E.setGenerator(d, v, l.id, pick(GENS, st.a)!)],
    ["setSpans", (d) => l && E.setSpans(d, v, l.id, st.y < 0.2 ? null : [{ from: bar, ...(st.y > 0.5 ? { to: round3(bar + 1 + st.y * 8) } : {}), ...(st.y > 0.7 ? { fadeIn: 2, fadeOut: 1 } : {}) }])],
    ["splitLayerAt", (d) => l && E.splitLayerAt(d, v, l.id, bar, secondsToBar(0, grid))],
    ["addEffect", (d) => l && E.addEffect(d, v, l.id, pick(FXS, st.a)!)],
    ["removeEffect", (d) => l && E.removeEffect(d, v, l.id, st.a % Math.max(1, l.effects?.length ?? 1))],
    ["moveEffect", (d) => l && E.moveEffect(d, v, l.id, st.a % Math.max(1, l.effects?.length ?? 1), st.x < 0.5 ? -1 : 1)],
    ["setEffectParam", (d) => { const fx = l?.effects?.[st.a % Math.max(1, l.effects.length)]; const sp = fx && pick(EFFECTS[fx.type]!.params, st.b); if (l && fx && sp) E.setEffectParam(d, v, l.id, st.a % l.effects!.length, sp.name, round3(sp.min + st.y * (sp.max - sp.min))); }],
    ["setLayout", (d) => l && E.setLayout(d, v, l.id, pick(FAMILIES, st.a)!, { x: round3(st.x), y: round3(st.y), w: round3(0.1 + st.x), h: round3(0.1 + st.y), rotation: Math.round(st.x * 90) })],
    ["patchLayer", (d) => l && E.patchLayer(d, v, l.id, [{ blend: "add" as const }, { track: pick(doc.song.tracks, st.a)!.id }, { text: `t${st.a % 7}` }, { name: `n${st.b % 5}` }][st.a % 4]!)],
    ["resetSetting", (d) => l && E.resetSetting(d, v, l.id, [{ field: "blend" as const }, { field: "track" as const }, { field: "spans" as const }, { field: "effects" as const }, { param: "opacity" }, { layout: "portrait" as const }][st.b % 6]!)],
    ["resetLayer", (d) => l && E.resetLayer(d, v, l.id)],
    ["restoreLayer", (d) => { const r = pick(E.removedLayers(doc, v), st.b); if (r) E.restoreLayer(d, v, r.id); }],
    ["setLane", (d) => t && E.setLane(d, v, t.target, [{ bar, v: value }, { bar: round3(bar + 1 + st.y * 4), v: t.min, ...(st.x > 0.5 ? { curve: "hold" as const } : {}) }])],
    ["addLane", (d) => t && E.addLane(d, v, t.target, { bar }, value)],
    ["removeLane", (d) => { const ln = pick((resolveVideo(v, (n) => doc.videos[n]!).automation ?? []).filter((a) => a.points.length), st.b); if (ln) E.removeLane(d, v, ln.target); }],
    ["resetLane", (d) => { const ln = pick(doc.videos[v]!.automation ?? [], st.b); if (ln) E.resetLane(d, v, ln.target); }],
    ["addMod", (d) => t && E.addMod(d, v, { target: t.target, source: `${pick(doc.song.tracks, st.a)!.id}.${pick(FEATURES, st.b)!}`, amount: round3((st.y - 0.5) * (t.max - t.min)) })],
    ["setMod", (d) => { const m = pick((resolveVideo(v, (n) => doc.videos[n]!).modulations ?? []).filter((x) => !x.remove), st.b); if (m) E.setMod(d, v, m.target, m.source, { ...m, source: st.x < 0.3 ? `${pick(doc.song.tracks, st.a)!.id}.${pick(FEATURES, st.a)!}` : m.source, amount: round3(st.y * 2 - 1), curve: (["linear", "square", "sqrt"] as const)[st.a % 3] }); }],
    ["removeMod", (d) => { const m = pick((resolveVideo(v, (n) => doc.videos[n]!).modulations ?? []).filter((x) => !x.remove), st.b); if (m) E.removeMod(d, v, m.target, m.source); }],
    ["resetMod", (d) => { const m = pick(doc.videos[v]!.modulations ?? [], st.b); if (m) E.resetMod(d, v, m.target, m.source); }],
    ["setVideo", (d) => E.setVideo(d, v, [{ format: pick(FORMATS, st.b) }, { range: st.y < 0.3 ? undefined : { from: bar, to: round3(bar + 2 + st.y * 8) } }, { name: `video ${st.b % 9}` }][st.a % 3]!)],
    ["newVideo", (d) => E.newVideo(d, { name: `v${st.b % 4}`, format: pick(FORMATS, st.a)!, ...(st.x < 0.33 ? {} : { from: { video: v, how: st.x < 0.66 ? "base" as const : "copy" as const } }) })],
    ["detachVideo", (d) => E.detachVideo(d, v)],
  ];
  const [name, fn] = ops[st.op % ops.length]!;
  s.apply(name, (d) => { fn(d); });
  return `${name} on ${v}${l ? ` (layer ${l.id})` : ""}`;
}

/** Everything the editor and renderer derive from a video must work, and nothing may be invalid. */
function check(doc: Doc, where: string) {
  for (const [name, file] of Object.entries(doc.videos)) {
    const json = JSON.parse(JSON.stringify(file));
    expect(videoSchema(json), `${where}: videos/${name}.json doesn't match the file format: ${JSON.stringify(videoSchema.errors)}`).toBe(true);
    const video = resolveVideo(name, (n) => doc.videos[n]!);
    const project = buildProject(doc.song, video, (t) => t.file);
    expect(validateProject(project), `${where}: video ${name} is invalid`).toEqual([]);
    for (const lane of project.automation ?? []) if (!isColorLane(lane)) laneToSeconds(lane, project.grid);
    for (const l of project.layers) if (l.spans?.length) spansToSeconds(l.spans, project.grid!);
    new ParamResolver(project);
  }
  // nothing that saving would lose or change: numbers are finite, no undefined values in lists
  const walk = (x: unknown, path: string): void => {
    if (typeof x === "number") expect(Number.isFinite(x), `${where}: ${path} is ${x}`).toBe(true);
    else if (Array.isArray(x)) x.forEach((y, i) => { expect(y, `${where}: ${path}[${i}] is undefined`).not.toBeUndefined(); walk(y, `${path}[${i}]`); });
    else if (x && typeof x === "object") for (const [k, y] of Object.entries(x)) walk(y, `${path}.${k}`);
  };
  walk(doc, "doc");
}

describe("bug sweep: rules that hold after any sequence of edits", () => {
  it("the demo project starts valid", () => check(start(), "start"));

  it("every edit leaves every video valid; undo and redo are exact; only the edited video's file changes", () => {
    fc.assert(fc.property(fc.array(step, { minLength: 1, maxLength: 25 }), (steps) => {
      const s = new Session(start());
      for (const st of steps) {
        const before = JSON.stringify(s.doc);
        const beforeVideos = structuredClone(s.doc.videos);
        const what = apply(s, st);
        const after = JSON.stringify(s.doc);
        check(s.doc, what);
        if (after === before) continue; // the edit changed nothing (an operation that didn't apply here)
        // only the video edited changes (a new video is added; detaching rewrites only that video)
        const changed = Object.keys(s.doc.videos).filter((n) => JSON.stringify(s.doc.videos[n]) !== JSON.stringify(beforeVideos[n]));
        expect(changed.length, `${what}: changed ${changed.join(", ")}`).toBeLessThanOrEqual(1);
        expect(JSON.stringify(s.doc.song), `${what}: changed the song`).toBe(JSON.stringify(start().song));
        // undo restores exactly; redo brings the edit back
        s.undo();
        expect(JSON.stringify(s.doc), `${what}: undo`).toBe(before);
        s.redo();
        expect(JSON.stringify(s.doc), `${what}: redo`).toBe(after);
      }
    }), fuzz(300));
  });

  it("saving and loading again changes nothing", () => {
    fc.assert(fc.property(fc.array(step, { minLength: 1, maxLength: 25 }), (steps) => {
      const s = new Session(start());
      for (const st of steps) apply(s, st);
      // what the server writes (JSON) and the next session reads back
      const saved = JSON.parse(JSON.stringify({ song: s.doc.song, videos: s.doc.videos })) as Doc;
      const reloaded = new Session(saved);
      expect(reloaded.dirtyFiles()).toEqual([]);
      for (const name of Object.keys(s.doc.videos)) {
        const a = buildProject(s.doc.song, resolveVideo(name, (n) => s.doc.videos[n]!), (t) => t.file);
        const b = buildProject(saved.song, resolveVideo(name, (n) => saved.videos[n]!), (t) => t.file);
        expect(JSON.stringify(b), `video ${name} after saving and loading`).toBe(JSON.stringify(a));
      }
    }), fuzz(200));
  });
});
