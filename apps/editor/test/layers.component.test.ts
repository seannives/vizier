import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import ParamControl from "../src/app/components/ParamControl.svelte";
import LayerList from "../src/app/components/LayerList.svelte";
import LayerPanel from "../src/app/components/LayerPanel.svelte";
import { Session, type Doc } from "../src/app/lib/session.ts";
import { layersOf, layerOf } from "../src/app/lib/edits.ts";
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
    await fireEvent.click(r.container.querySelector('[data-layer="title"] button[title="Remove"]')!);
    expect(layersOf(s.doc, "full").map((l) => l.id).sort()).toEqual(["pulseGrid", "ring"]);
  });
});

describe("LayerPanel", () => {
  const base = { video: "full", tracks: doc().song.tracks, startBar: 1, automated: new Set<string>(), onselect: () => {} };
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
});
