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
});
