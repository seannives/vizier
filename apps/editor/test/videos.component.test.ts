import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import LayerList from "../src/app/components/LayerList.svelte";
import LayerPanel from "../src/app/components/LayerPanel.svelte";
import VideoPanel from "../src/app/components/VideoPanel.svelte";
import NewVideo from "../src/app/components/NewVideo.svelte";
import { Session, type Doc } from "../src/app/lib/session.ts";
import { layersOf, layerOf, setParam, removeLayer } from "../src/app/lib/edits.ts";
import { stubDom } from "./setup-dom.ts";

beforeAll(stubDom);
afterEach(cleanup);

const L = { landscape: { x: 0.5, y: 0.5, w: 1, h: 1 } };
const doc = (): Doc => ({
  song: { version: 2, title: "t", grid: { tempo: [{ bar: 1, bpm: 120, beatsPerBar: 4 }], downbeat: 0 },
    tracks: [{ id: "mix", name: "Mix", file: "m.wav", mix: true }, { id: "bass", name: "303", file: "b.wav" }] },
  videos: {
    full: { version: 2, name: "Full", format: "youtube", layers: [
      { id: "ring", name: "Acid ring", generator: "acidRing", track: "bass", z: 1, params: { radius: 0.3 }, layout: L },
      { id: "title", name: "Title", generator: "typeText", z: 2, text: "hi", layout: L },
    ] },
    reel: { version: 2, name: "Reel", base: "full", format: "reels", range: { from: 9, to: 17 },
      layers: [{ id: "caption", name: "Caption", generator: "typeText", z: 3, text: "c", layout: L }] },
  },
});
function setup() {
  const s = new Session(doc());
  const edit = (label: string, fn: (d: Doc) => void, merge?: string) => { s.apply(label, fn, { merge }); };
  return { s, edit, seal: () => s.seal() };
}
const listProps = (s: Session, edit: any) => ({ layers: [...layersOf(s.doc, "reel")].sort((a, b) => b.z - a.z), video: "reel", doc: s.doc, selected: null, trackName: () => "", edit, onselect: () => {} });

describe("marking what a video inherits", () => {
  it("tags layers as added here, from the base, or changed here; lists removed ones to restore", async () => {
    const { s, edit } = setup();
    s.apply("x", (d) => setParam(d, "reel", "ring", "radius", 0.5));
    s.apply("x", (d) => removeLayer(d, "reel", "title"));
    const r = render(LayerList, listProps(s, edit));
    const tag = (id: string) => r.container.querySelector(`[data-layer="${id}"] .tag`)?.textContent;
    expect([tag("caption"), tag("ring")]).toEqual(["added", "changed"]);
    expect(r.container.querySelector('[data-layer="title"]')).toBeNull();
    await fireEvent.click(r.container.querySelector('[data-removed="title"] button')!);
    expect(layersOf(s.doc, "reel").map((l) => l.id).sort()).toEqual(["caption", "ring", "title"]);
    await r.rerender(listProps(s, edit));
    expect(r.container.querySelector('[data-layer="title"] .tag')?.textContent).toBe("base");
  });
  it("in a video without a base, layers aren't tagged", () => {
    const { s, edit } = setup();
    const r = render(LayerList, { ...listProps(s, edit), video: "full", layers: layersOf(s.doc, "full") });
    expect(r.container.querySelector(".tag")).toBeNull();
  });
  it("resets one changed parameter, or the whole layer, to the base's", async () => {
    const { s, edit, seal } = setup();
    s.apply("x", (d) => { setParam(d, "reel", "ring", "radius", 0.5); setParam(d, "reel", "ring", "spike", 0.9); });
    const props = () => ({ doc: s.doc, video: "reel", layerId: "ring", tracks: doc().song.tracks, playheadBar: 1, automated: new Set<string>(), edit, seal, onselect: () => {} });
    const r = render(LayerPanel, props());
    expect(r.getByText("changed here")).toBeTruthy();
    expect(r.queryByLabelText("Reset Opacity to base")).toBeNull();          // not changed: no reset
    await fireEvent.click(r.getByLabelText("Reset Radius to base"));
    expect(layerOf(s.doc, "reel", "ring")!.params).toEqual({ radius: 0.3, spike: 0.9 });
    await r.rerender(props());
    await fireEvent.click(r.getByText("Reset layer to base"));
    expect(layerOf(s.doc, "reel", "ring")).toEqual(layerOf(s.doc, "full", "ring"));
  });
});

describe("an inherited layer on the mix", () => {
  it("choosing the mix as an inherited layer's track saves it (not a value the file would drop)", async () => {
    const { s, edit, seal } = setup();
    s.apply("x", (d) => { d.videos.full!.layers![0]!.track = "bass"; });
    const r = render(LayerPanel, { doc: s.doc, video: "reel", layerId: "ring", tracks: doc().song.tracks, playheadBar: 1, automated: new Set<string>(), edit, seal, onselect: () => {} });
    const track = r.getByLabelText("Track") as HTMLSelectElement;
    track.value = ""; await fireEvent.change(track);
    const saved = JSON.parse(JSON.stringify(s.doc)) as Doc;   // what the file would hold
    expect(layerOf(saved, "reel", "ring")!.track).toBe("mix");
  });
});

describe("video settings", () => {
  const vprops = (s: Session, edit: any, onopen = vi.fn()) => ({ doc: s.doc, video: "reel", rangeLabel: "bars 9 – 17", rangeTime: "", rangeInherited: false, edit, onopen });
  it("renames, changes format (↺ back to the base's), resets the range, opens the base and detaches", async () => {
    const { s, edit } = setup();
    const onopen = vi.fn();
    const r = render(VideoPanel, vprops(s, edit, onopen));
    const name = r.getByLabelText("Video name") as HTMLInputElement;
    name.value = "Reel: the drop"; await fireEvent.change(name);
    expect(s.doc.videos.reel!.name).toBe("Reel: the drop");
    const fmt = r.getByLabelText("Format") as HTMLSelectElement;
    fmt.value = "shorts"; await fireEvent.change(fmt);
    expect(s.doc.videos.reel!.format).toBe("shorts");
    await r.rerender(vprops(s, edit, onopen));
    await fireEvent.click(r.getByTitle("Back to the base's format"));
    expect(s.doc.videos.reel!.format).toBeUndefined();                       // inherits youtube again
    await fireEvent.click(r.getByTitle("Back to the base's range"));
    expect(s.doc.videos.reel!.range).toBeUndefined();
    await fireEvent.click(r.getByText("Full"));
    expect(onopen).toHaveBeenCalledWith("full");
    await fireEvent.click(r.getByText("Detach"));
    expect(s.doc.videos.reel!.base).toBeUndefined();
    expect(layersOf(s.doc, "reel").map((l) => l.id).sort()).toEqual(["caption", "ring", "title"]);
  });
  it("fades: shows the defaults, sets this video's (↺ back to the base's); the cover: at the playhead, or back", async () => {
    const { s, edit } = setup();
    s.apply("base fade", (d) => { d.videos.full!.fade = { out: 2 }; });
    const props = () => ({ ...vprops(s, edit, vi.fn()), playheadBar: 12.5 });
    const r = render(VideoPanel, props());
    const fin = r.getByLabelText("Fade in") as HTMLInputElement, fout = r.getByLabelText("Fade out") as HTMLInputElement;
    expect([fin.value, fout.value]).toEqual(["0", "2"]);                       // the default in; the base's out
    fin.value = "0.5"; await fireEvent.change(fin);
    expect(s.doc.videos.reel!.fade).toEqual({ in: 0.5 });
    await r.rerender(props());
    await fireEvent.click(r.getByTitle("Back to the base's: 0"));
    expect(s.doc.videos.reel!.fade).toBeUndefined();
    await fireEvent.click(r.getByText("Here"));
    expect(s.doc.videos.reel!.cover).toBe(12.5);
    await r.rerender(props());
    await fireEvent.click(r.getByTitle("Back to the base's"));
    expect(s.doc.videos.reel!.cover).toBeUndefined();
  });
  it("the new-video dialog builds on, copies, or starts blank", async () => {
    const oncreate = vi.fn();
    const r = render(NewVideo, { currentName: "Reel", currentFormat: "reels", how: "copy", oncreate, oncancel: () => {} });
    expect((r.getByLabelText("New video name") as HTMLInputElement).value).toBe("Reel copy");
    await fireEvent.click(r.getByLabelText(/Blank/));
    const name = r.getByLabelText("New video name") as HTMLInputElement;
    name.value = "Short"; await fireEvent.input(name);
    const fmt = r.getByLabelText("New video format") as HTMLSelectElement;
    fmt.value = "shorts"; await fireEvent.change(fmt);
    await fireEvent.click(r.getByText("Create"));
    expect(oncreate).toHaveBeenCalledWith({ name: "Short", format: "shorts", how: "blank" });
  });
});
