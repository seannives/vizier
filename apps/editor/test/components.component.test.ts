import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { tick } from "svelte";
import Help from "../src/app/components/Help.svelte";
import Timeline from "../src/app/components/Timeline.svelte";
import { stubDom } from "./setup-dom.ts";
import type { Shortcut } from "../src/app/lib/shortcuts.ts";

beforeAll(stubDom);
afterEach(cleanup);

describe("Help", () => {
  const shortcuts: Shortcut[] = [
    { keys: "Space", label: "Play / stop", group: "Transport", run: () => {} },
    { keys: "+", alt: ["="], label: "Zoom in", group: "View", run: () => {} },
    { keys: "Enter", display: "Return  or fn←", label: "Go to start", group: "Transport", run: () => {} },
  ];
  it("lists shortcuts by group, with their keys", () => {
    const { getAllByRole, getByText } = render(Help, { shortcuts, onclose: () => {} });
    expect(getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Transport", "View"]);
    expect(getByText("Zoom in").previousElementSibling!.textContent).toBe("+");
    expect(getByText("Go to start").previousElementSibling!.textContent).toBe("Return  or fn←");
  });
  it("closes when you click outside the panel", async () => {
    const onclose = vi.fn();
    const { container } = render(Help, { shortcuts, onclose });
    await fireEvent.click(container.querySelector(".scrim")!);
    expect(onclose).toHaveBeenCalledOnce();
  });
});

describe("Timeline", () => {
  // 120 BPM, bar 1 at 0 s: a beat is 0.5 s
  const grid = { tempo: [{ bar: 1, bpm: 120, beatsPerBar: 4 }], downbeat: 0 };
  const base = { grid, sections: [], tracks: [], duration: 60, range: null, rangeInherited: false, follow: false, onrange: () => {} };
  const setup = async (props: Record<string, unknown>) => {
    const onseek = vi.fn();
    const r = render(Timeline, { ...base, time: 0, onseek, ...props } as any);
    await tick();
    const tl = r.component as any;
    const canvas = r.container.querySelector("canvas")!;
    // jsdom has no layout: put the canvas at the page's left edge and click at the x of a given time
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 200, width: 800, height: 200, x: 0, y: 0, toJSON() {} });
    const clickAt = async (t: number, shiftKey = false) => {
      const x = tl.pageX(t);
      // jsdom doesn't fill in offsetX/offsetY, so set them on the event
      const ev = (type: string) => Object.defineProperties(new MouseEvent(type, { bubbles: true, shiftKey }), {
        offsetX: { value: x }, offsetY: { value: 100 }, pointerId: { value: 1 } });
      await fireEvent(canvas, ev("pointerdown"));
      await fireEvent(canvas, ev("pointerup"));
    };
    return { ...r, tl, onseek, clickAt };
  };

  it("draws the playhead as a layer at the playing time", async () => {
    const { container, tl } = await setup({ time: 12.3 });
    const ph = container.querySelector<HTMLElement>(".playhead")!;
    expect(ph.style.transform).toBe(`translateX(${tl.pageX(12.3)}px)`);
  });
  it("snaps a click to the nearest beat when Snap is on, and not when ⇧ is held", async () => {
    const { onseek, clickAt } = await setup({ snap: true });
    await clickAt(10.2);
    expect(onseek).toHaveBeenLastCalledWith(10);
    await clickAt(10.2, true);
    expect(onseek.mock.lastCall![0]).toBeCloseTo(10.2, 1);
  });
  it("puts a click exactly where you click when Snap is off", async () => {
    const { onseek, clickAt } = await setup({ snap: false });
    await clickAt(10.2);
    expect(onseek.mock.lastCall![0]).toBeCloseTo(10.2, 1);
  });

  describe("layer rows (when a layer is on)", () => {
    // one track (the mix), with one layer under it: on 10–20 s; the layer row is just below the track's waveform
    const layer = (spans: { from: number; to: number; fadeIn: number; fadeOut: number }[] | null) => ({ id: "ring", name: "Ring", track: "mix", spans });
    async function rows(spans: Parameters<typeof layer>[0]) {
      const onspans = vi.fn(), onselectlayer = vi.fn(), onseek = vi.fn();
      const r = render(Timeline, { ...base, time: 0, snap: true, tracks: [{ id: "mix", name: "Mix", mix: true, wave: null }],
        layers: [layer(spans)], onspans, onselectlayer, onseek } as any);
      await tick();
      const tl = r.component as any;
      const body = r.container.querySelectorAll("canvas")[1]!;
      const ev = (type: string, t: number, shiftKey = false) => Object.defineProperties(new MouseEvent(type, { bubbles: true, shiftKey }), {
        offsetX: { value: tl.pageX(t) - 0 }, offsetY: { value: 46 + 9 }, pointerId: { value: 1 } }); // the layer row, in the tracks canvas
      for (const c of r.container.querySelectorAll("canvas")) c.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 200, width: 800, height: 200, x: 0, y: 0, toJSON() {} });
      const drag = async (from: number, to: number, shiftKey = false) => {
        await fireEvent(body, ev("pointerdown", from, shiftKey));
        await fireEvent(body, ev("pointermove", (from + to) / 2, shiftKey));
        await fireEvent(body, ev("pointermove", to, shiftKey));
        await fireEvent(body, ev("pointerup", to, shiftKey));
      };
      return { onspans, onselectlayer, onseek, drag };
    }
    const on = { from: 10, to: 20, fadeIn: 0, fadeOut: 0 };
    it("dragging in an empty part makes a span (snapped to beats) and selects it", async () => {
      const { onspans, onselectlayer, drag } = await rows([on]);
      await drag(30.2, 35.9);
      expect(onspans).toHaveBeenCalledWith("ring", [on, { from: 30, to: 36, fadeIn: 0, fadeOut: 0 }]);
      expect(onselectlayer).toHaveBeenLastCalledWith("ring", 1);
    });
    it("a layer that's on for the whole song becomes on just for the dragged span", async () => {
      const { onspans, drag } = await rows(null);
      await drag(4, 8);
      expect(onspans).toHaveBeenCalledWith("ring", [{ from: 4, to: 8, fadeIn: 0, fadeOut: 0 }]);
    });
    it("drags a span's start and end, and moves it whole", async () => {
      const a = await rows([on]);
      await a.drag(10, 12.2);
      expect(a.onspans).toHaveBeenLastCalledWith("ring", [{ ...on, from: 12 }]);
      const b = await rows([on]);
      await b.drag(20, 25.1);
      expect(b.onspans).toHaveBeenLastCalledWith("ring", [{ ...on, to: 25 }]);
      const c = await rows([on]);
      await c.drag(15, 17);
      expect(c.onspans).toHaveBeenLastCalledWith("ring", [{ ...on, from: 12, to: 22 }]);
      const d = await rows([on]);
      await d.drag(15, 17.2, true); // ⇧: no snapping
      expect(d.onspans.mock.lastCall![1][0].from).toBeCloseTo(12.2, 1);
    });
    it("a click on a span selects it; a click in empty space selects the layer and moves the playhead", async () => {
      const { onspans, onselectlayer, onseek, drag } = await rows([on]);
      await drag(15, 15);
      expect(onselectlayer).toHaveBeenLastCalledWith("ring", 0);
      expect(onseek).not.toHaveBeenCalled();
      await drag(40.2, 40.2);
      expect(onselectlayer).toHaveBeenLastCalledWith("ring", null);
      expect(onseek).toHaveBeenLastCalledWith(40);
      expect(onspans).not.toHaveBeenCalled();
    });
  });

  describe("automation lanes", () => {
    // one track, one layer unfolded, one lane under it: 0..1, a point at 10 s (0.2) and 20 s (0.8)
    const pts = [{ t: 10, v: 0.2 }, { t: 20, v: 0.8 }];
    async function lane(points = pts) {
      const cb = { onlanepoints: vi.fn(), onselectpoint: vi.fn(), onlanecurve: vi.fn(), onlaneremove: vi.fn(), ontogglelanes: vi.fn(), onhidelane: vi.fn() };
      const r = render(Timeline, { ...base, time: 0, snap: true, tracks: [{ id: "mix", name: "Mix", mix: true, wave: null }],
        layers: [{ id: "ring", name: "Ring", track: "mix", spans: null, lanes: 1 }], shownLanes: new Set(["ring.spike"]),
        lanes: [{ target: "ring.spike", layer: "ring", label: "Spikes", min: 0, max: 1, int: false, points, origin: "own" }],
        selectedPoint: { target: "ring.spike", index: 0 }, ...cb } as any);
      await tick();
      const tl = r.component as any;
      const body = r.container.querySelectorAll("canvas")[1]!;
      // lane row: below the track (46) and the layer row (18); 46 tall, values drawn from y+5 (1) to y+41 (0)
      const yOf = (v: number) => 46 + 18 + 5 + (1 - v) * 36;
      const ev = (type: string, t: number, v: number, shiftKey = false) => Object.defineProperties(new MouseEvent(type, { bubbles: true, shiftKey }), {
        offsetX: { value: tl.pageX(t) }, offsetY: { value: yOf(v) }, pointerId: { value: 1 } });
      const drag = async (from: [number, number], to: [number, number]) => {
        await fireEvent(body, ev("pointerdown", ...from)); await fireEvent(body, ev("pointermove", ...to)); await fireEvent(body, ev("pointerup", ...to));
      };
      return { r, cb, drag };
    }
    it("a click adds a breakpoint (time snapped to the beat), with the value where you clicked", async () => {
      const { cb, drag } = await lane();
      await drag([15.1, 0.5], [15.1, 0.5]);
      const [target, out] = cb.onlanepoints.mock.lastCall!;
      expect(target).toBe("ring.spike");
      expect(out.map((p: any) => p.t)).toEqual([10, 15, 20]);
      expect(out[1].v).toBeCloseTo(0.5, 1);
      expect(cb.onselectpoint).toHaveBeenLastCalledWith("ring.spike", 1);
    });
    it("drags a breakpoint, but not past its neighbours", async () => {
      const { cb, drag } = await lane();
      await drag([10, 0.2], [12, 0.6]);
      expect(cb.onlanepoints.mock.lastCall![1][0]).toEqual({ t: 12, v: expect.closeTo(0.6, 1) });
      await drag([10, 0.2], [25, 0.6]);
      expect(cb.onlanepoints.mock.lastCall![1][0].t).toBe(20); // stops at the next point
    });
    it("a click on a breakpoint selects it without changing anything", async () => {
      const { cb, drag } = await lane();
      await drag([20, 0.8], [20, 0.8]);
      expect(cb.onselectpoint).toHaveBeenLastCalledWith("ring.spike", 1);
      expect(cb.onlanepoints).not.toHaveBeenCalled();
    });
    it("the lane's header sets the curve after the selected point, and removes the lane", async () => {
      const { r, cb } = await lane();
      await fireEvent.click(r.getByTitle(/^Hold/));
      expect(cb.onlanecurve).toHaveBeenCalledWith("ring.spike", 0, "hold");
      await fireEvent.click(r.getByTitle("Remove this lane"));
      expect(cb.onlaneremove).toHaveBeenCalledWith("ring.spike");
      await fireEvent.click(r.container.querySelector('[data-fold="ring"]')!);
      expect(cb.ontogglelanes).toHaveBeenCalledWith("ring");
      await fireEvent.click(r.getByLabelText("Hide lane"));
      expect(cb.onhidelane).toHaveBeenCalledWith("ring.spike");
    });
  });
});
