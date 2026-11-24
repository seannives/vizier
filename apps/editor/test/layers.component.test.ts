import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import ParamControl from "../src/app/components/ParamControl.svelte";
import LayerList from "../src/app/components/LayerList.svelte";
import LayerPanel from "../src/app/components/LayerPanel.svelte";
import { Session, type Doc } from "../src/app/lib/session.ts";
import { layersOf, layerOf, modsOf, addMod } from "../src/app/lib/edits.ts";
import { stubDom } from "./setup-dom.ts";

beforeAll(stubDom);
afterEach(cleanup);

const L = { landscape: { x: 0.5, y: 0.5, w: 1, h: 1 } };
const doc = (): Doc => ({
  song: { version: 2, title: "t", grid: { tempo: [{ bar: 1, bpm: 120, beatsPerBar: 4 }], downbeat: 0 },
    tracks: [{ id: "mix", name: "Mix", file: "m.wav", mix: true }, { id: "bass", name: "303", file: "b.wav" }] },
  videos: { full: { version: 2, format: "youtube", layers: [
    { id: "ring", name: "Acid ring", generator: "acidRing", track: "bass", z: 1, layout: L },
    { id: "title", name: "Title", generator: "typeText", z: 2, text: "hi", layout: L },
  ] } },
});
/** A session and the edit/seal functions the editor hands to its panels. */
function setup() {
  const s = new Session(doc());
  const edit = (label: string, fn: (d: Doc) => void, merge?: string) => { s.apply(label, fn, { merge }); };
  return { s, edit, seal: () => s.seal() };
}

describe("ParamControl", () => {
  const spec = { name: "radius", label: "Radius", min: 0, max: 1, default: 0.3 };
  it("reports slider moves as provisional and the release as final; double-click resets", async () => {
    const onchange = vi.fn();
    const { getByLabelText, getByText } = render(ParamControl, { spec, value: 0.5, onchange });
    const slider = getByLabelText("Radius slider") as HTMLInputElement;
    slider.value = "0.6"; await fireEvent.input(slider);
    expect(onchange).toHaveBeenLastCalledWith(0.6, false);
    await fireEvent.change(slider);
    expect(onchange).toHaveBeenLastCalledWith(0.6, true);
    await fireEvent.dblClick(getByText("Radius"));
    expect(onchange).toHaveBeenLastCalledWith(0.3, true);
  });
  it("takes typed values, even past the slider's range", async () => {
    const onchange = vi.fn();
    const { getByLabelText } = render(ParamControl, { spec, value: 0.5, onchange });
    const box = getByLabelText("Radius") as HTMLInputElement;
    box.value = "1.5"; await fireEvent.change(box);
    expect(onchange).toHaveBeenLastCalledWith(1.5, true);
    box.value = "abc"; await fireEvent.change(box);
    expect(onchange).toHaveBeenCalledTimes(1);
    expect(box.value).toBe("0.5");
  });
});

describe("LayerList", () => {
  it("adds a layer and selects it; moves and removes layers", async () => {
    const { s, edit } = setup();
    const onselect = vi.fn();
    const props = () => ({ layers: [...layersOf(s.doc, "full")].sort((a, b) => b.z - a.z), video: "full", selected: null, trackName: (id?: string) => id ?? "Mix", edit, onselect });
    const r = render(LayerList, props());
    const add = r.getByLabelText("Add a layer") as HTMLSelectElement;
    add.value = "pulseGrid"; await fireEvent.change(add);
    expect(onselect).toHaveBeenLastCalledWith("pulseGrid");
    expect(layerOf(s.doc, "full", "pulseGrid")!.z).toBe(3);
    await r.rerender(props());
    await fireEvent.click(r.container.querySelector('[data-layer="ring"] button[title="Move in front"]')!);
    expect(layerOf(s.doc, "full", "ring")!.z).toBeGreaterThan(layerOf(s.doc, "full", "title")!.z);
    await fireEvent.click(r.container.querySelector('[data-layer="title"] button.rm')!);
    expect(layersOf(s.doc, "full").map((l) => l.id).sort()).toEqual(["pulseGrid", "ring"]);
  });
});

describe("LayerPanel", () => {
  const base = { video: "full", tracks: doc().song.tracks, startBar: 1, automated: new Set<string>(), onselect: () => {} };
  it("modulation presets: only those that fit the layer are offered; one adds its modulations and opens them", async () => {
    const { s, edit, seal } = setup();
    const r = render(LayerPanel, { ...base, doc: s.doc, layerId: "ring", playheadBar: 9, edit, seal });
    const menu = r.getByLabelText("Modulation preset") as HTMLSelectElement;
    const offered = [...menu.options].map((o) => o.value).filter(Boolean);
    expect(offered).toContain("squelch");
    menu.value = "flash"; await fireEvent.change(menu);
    expect(s.undoLabel).toBe("preset: Flash on hits");
    const mods = (s.doc.videos.full!.modulations ?? []).filter((m) => m.target === "ring.lightness");
    expect(mods).toEqual([{ target: "ring.lightness", source: "bass.hit", amount: 0.45 }]);
    await r.rerender({ ...base, doc: s.doc, layerId: "ring", playheadBar: 9, edit, seal });
    expect(r.container.querySelector('[data-mod="bass.hit"]')).not.toBeNull();                      // its row is open
  });
  it("changes the track and generator", async () => {
    const { s, edit, seal } = setup();
    const r = render(LayerPanel, { ...base, doc: s.doc, layerId: "ring", playheadBar: 9, edit, seal });
    const track = r.getByLabelText("Track") as HTMLSelectElement;
    track.value = ""; await fireEvent.change(track);
    expect(layerOf(s.doc, "full", "ring")!.track).toBeUndefined(); // the mix
    const gen = r.getByLabelText("Generator") as HTMLSelectElement;
    gen.value = "pulseGrid"; await fireEvent.change(gen);
    expect(layerOf(s.doc, "full", "ring")!.generator).toBe("pulseGrid");
  });
  it("splits at the playhead, and edits a span's bars and fades", async () => {
    const { s, edit, seal } = setup();
    const r = render(LayerPanel, { ...base, doc: s.doc, layerId: "ring", playheadBar: 49, edit, seal });
    expect(r.getByText("Whole song")).toBeTruthy();
    await fireEvent.click(r.getByText("Split at playhead"));
    expect(layerOf(s.doc, "full", "ring")!.spans).toEqual([{ from: 1, to: 49 }, { from: 49 }]);
    await r.rerender({ ...base, doc: s.doc, layerId: "ring", playheadBar: 49, edit, seal });
    const fadeOut = r.getAllByLabelText("Fade out (beats)")[0] as HTMLInputElement;
    fadeOut.value = "4"; await fireEvent.change(fadeOut);
    expect(layerOf(s.doc, "full", "ring")!.spans![0]).toEqual({ from: 1, to: 49, fadeOut: 4 });
  });
  it("slider drags are one undo step", async () => {
    const { s, edit, seal } = setup();
    const r = render(LayerPanel, { ...base, doc: s.doc, layerId: "ring", playheadBar: 1, edit, seal });
    const slider = r.getByLabelText("Opacity slider") as HTMLInputElement;
    for (const v of ["0.9", "0.7", "0.5"]) { slider.value = v; await fireEvent.input(slider); }
    await fireEvent.change(slider);
    expect(layerOf(s.doc, "full", "ring")!.params!.opacity).toBe(0.5);
    s.undo();
    expect(layerOf(s.doc, "full", "ring")!.params).toBeUndefined();
  });

  it("adds, reorders and removes effects, and sets an effect's parameter (one undo per drag)", async () => {
    const { s, edit, seal } = setup();
    const props = () => ({ ...base, doc: s.doc, layerId: "ring", playheadBar: 1, edit, seal });
    const r = render(LayerPanel, props());
    const add = r.getByLabelText("Add an effect") as HTMLSelectElement;
    add.value = "trails"; await fireEvent.change(add);
    add.value = "glow"; await fireEvent.change(add);
    await r.rerender(props());
    expect(layerOf(s.doc, "full", "ring")!.effects!.map((e) => e.type)).toEqual(["trails", "glow"]);
    await fireEvent.click(r.getAllByTitle("Earlier in the chain")[1]!);
    await r.rerender(props());
    expect(layerOf(s.doc, "full", "ring")!.effects!.map((e) => e.type)).toEqual(["glow", "trails"]);
    const amount = r.getByLabelText("Amount slider") as HTMLInputElement;
    for (const v of ["0.2", "0.4"]) { amount.value = v; await fireEvent.input(amount); }
    await fireEvent.change(amount);
    expect(layerOf(s.doc, "full", "ring")!.effects![0]!.params).toEqual({ amount: 0.4 });
    s.undo();
    expect(layerOf(s.doc, "full", "ring")!.effects![0]!.params).toBeUndefined();
    await r.rerender(props());
    await fireEvent.click(r.getAllByTitle("Remove")[0]!);
    expect(layerOf(s.doc, "full", "ring")!.effects!.map((e) => e.type)).toEqual(["trails"]);
  });
  it("edits text (typing is one undo step)", async () => {
    const { s, edit, seal } = setup();
    const r = render(LayerPanel, { ...base, doc: s.doc, layerId: "title", playheadBar: 1, edit, seal });
    const box = r.getByLabelText("Text") as HTMLTextAreaElement;
    for (const t of ["h", "he", "hel", "hello"]) { box.value = t; await fireEvent.input(box); }
    await fireEvent.change(box);
    expect(layerOf(s.doc, "full", "title")!.text).toBe("hello");
    s.undo();
    expect(layerOf(s.doc, "full", "title")!.text).toBe("hi");
  });
  it("sets the layout from the number fields, for this video's shape", async () => {
    const { s, edit, seal } = setup();
    const props = () => ({ ...base, doc: s.doc, layerId: "ring", playheadBar: 1, edit, seal, family: "portrait" as const });
    const r = render(LayerPanel, props());
    expect(r.getByText(/Uses the landscape layout/)).toBeTruthy();
    const x = r.getByLabelText("X (% of width)") as HTMLInputElement;
    x.value = "30"; await fireEvent.change(x);
    expect(layerOf(s.doc, "full", "ring")!.layout.portrait).toEqual({ x: 0.3, y: 0.5, w: 1, h: 1 });
    expect(layerOf(s.doc, "full", "ring")!.layout.landscape).toEqual(L.landscape);
    await r.rerender(props());
    const rot = r.getByLabelText("Rotation (degrees)") as HTMLInputElement;
    rot.value = "45"; await fireEvent.change(rot);
    expect(layerOf(s.doc, "full", "ring")!.layout.portrait!.rotation).toBe(45);
    await r.rerender(props());
    await fireEvent.click(r.getByText("Fill frame"));
    expect(layerOf(s.doc, "full", "ring")!.layout.portrait).toEqual({ x: 0.5, y: 0.5, w: 1, h: 1 });
  });
});

describe("LayerList: rename and duplicate", () => {
  it("renames on double-click (Enter keeps it, Escape cancels)", async () => {
    const { s, edit } = setup();
    const props = () => ({ layers: [...layersOf(s.doc, "full")].sort((a, b) => b.z - a.z), video: "full", selected: "ring", trackName: () => "", edit, onselect: () => {} });
    const r = render(LayerList, props());
    await fireEvent.dblClick(r.container.querySelector('[data-layer="ring"] .lname')!);
    const input = r.container.querySelector("input.rename") as HTMLInputElement;
    input.value = "303 ring";
    await fireEvent.keyDown(input, { key: "Enter" });
    await fireEvent.blur(input);
    expect(layerOf(s.doc, "full", "ring")!.name).toBe("303 ring");
    await r.rerender(props());
    await fireEvent.dblClick(r.container.querySelector('[data-layer="ring"] .lname')!);
    const again = r.container.querySelector("input.rename") as HTMLInputElement;
    again.value = "nope";
    await fireEvent.keyDown(again, { key: "Escape" });
    expect(layerOf(s.doc, "full", "ring")!.name).toBe("303 ring");
  });
  it("duplicates a layer just behind it and selects the copy", async () => {
    const { s, edit } = setup();
    const onselect = vi.fn();
    const r = render(LayerList, { layers: [...layersOf(s.doc, "full")].sort((a, b) => b.z - a.z), video: "full", selected: "ring", trackName: () => "", edit, onselect });
    await fireEvent.click(r.container.querySelector('[data-layer="ring"] button[title^="Duplicate"]')!);
    expect(onselect).toHaveBeenLastCalledWith("acidRing");
    const copy = layerOf(s.doc, "full", "acidRing")!;
    expect(copy.name).toBe("Acid ring copy");
    expect(copy.z).toBeLessThan(layerOf(s.doc, "full", "ring")!.z);
  });
});

describe("audio modulation in the layer panel", () => {
  const feats = { bass: { version: 1 as const, fps: 10, frameCount: 100, bins: 1, scalars: { env: Array(100).fill(0.5), low: Array(100).fill(0.8) } as any, spectrum: [] } };
  const base = { video: "full", tracks: doc().song.tracks, startBar: 1, automated: new Set<string>(), onselect: () => {} };
  const props = (s: Session, edit: any, seal: any, time = 2) => ({ ...base, doc: s.doc, layerId: "ring", playheadBar: 1, edit, seal, time, features: feats });
  it("M adds a modulation from the layer's track (smoothed loudness) and shows it, with a live meter", async () => {
    const { s, edit, seal } = setup();
    const r = render(LayerPanel, props(s, edit, seal));
    await fireEvent.click(r.getByLabelText("Modulate Radius"));
    expect(modsOf(s.doc, "full", "ring.radius")).toEqual([{ target: "ring.radius", source: "bass.env", amount: 0.45 }]);
    await r.rerender(props(s, edit, seal));
    const row = r.container.querySelector('[data-mod="bass.env"]')!;
    expect(row.querySelector(".fill")!.getAttribute("data-level")).toBe("0.500");
    expect(row.querySelector(".adds")!.textContent).toBe("+0.23"); // 0.45 × 0.5
    expect(r.getByText("- modulated")).toBeTruthy();
    expect(r.getByLabelText("Modulate Radius").classList.contains("on")).toBe(true);
  });
  it("changes the feature, amount and curve; ✕ removes it; M hides and shows the rows", async () => {
    const { s, edit, seal } = setup();
    s.apply("x", (d) => addMod(d, "full", { target: "ring.radius", source: "bass.env", amount: 0.45 }));
    const r = render(LayerPanel, props(s, edit, seal));
    await fireEvent.click(r.getByLabelText("Modulate Radius")); // already modulated: shows its rows
    const feature = r.getByLabelText("Modulation feature") as HTMLSelectElement;
    feature.value = "low"; await fireEvent.change(feature);
    expect(modsOf(s.doc, "full", "ring.radius")[0]!.source).toBe("bass.low");
    await r.rerender(props(s, edit, seal));
    const amount = r.getByLabelText("Modulation amount (number)") as HTMLInputElement;
    amount.value = "-0.6"; await fireEvent.change(amount);
    await r.rerender(props(s, edit, seal));
    const curve = r.getByLabelText("Modulation curve") as HTMLSelectElement;
    curve.value = "square"; await fireEvent.change(curve);
    expect(modsOf(s.doc, "full", "ring.radius")).toEqual([{ target: "ring.radius", source: "bass.low", amount: -0.6, curve: "square" }]);
    await r.rerender(props(s, edit, seal));
    await fireEvent.click(r.getByLabelText("Modulate Radius")); // hides
    expect(r.container.querySelector("[data-mod]")).toBeNull();
    await fireEvent.click(r.getByLabelText("Modulate Radius")); // shows again
    await fireEvent.click(r.getByLabelText("Remove modulation"));
    expect(modsOf(s.doc, "full", "ring.radius")).toEqual([]);
  });
  it("removing the last modulation closes the rows and M; M then starts a new one", async () => {
    const { s, edit, seal } = setup();
    const r = render(LayerPanel, props(s, edit, seal));
    const M = () => r.getByLabelText("Modulate Radius");
    await fireEvent.click(M());
    await r.rerender(props(s, edit, seal));
    await fireEvent.click(r.getByLabelText("Remove modulation"));
    await r.rerender(props(s, edit, seal));
    expect(modsOf(s.doc, "full", "ring.radius")).toEqual([]);
    expect(r.queryByText("+ another")).toBeNull();
    expect(M().classList.contains("on")).toBe(false);
    expect(r.queryByText("- modulated")).toBeNull();
    // with rows open and no modulation left (e.g. after undo), M closes them rather than adding one
    await fireEvent.click(M());
    expect(modsOf(s.doc, "full", "ring.radius").length).toBe(1);
    s.undo();
    await r.rerender(props(s, edit, seal));
    await fireEvent.click(M());
    expect(modsOf(s.doc, "full", "ring.radius")).toEqual([]);
    expect(M().classList.contains("on")).toBe(false);
  });
});
