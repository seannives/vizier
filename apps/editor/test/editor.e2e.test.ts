// Drives the editor in headless Chrome against a temporary copy of the demo project.
// Shortcuts use ControlOrMeta: ⌘ on a Mac, Ctrl elsewhere, matching the editor.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";
import { DEMO, makeDemoTracks, wav } from "../../../scripts/demo-audio.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const chrome = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find((p) => p && existsSync(p));
const run = chrome ? describe : describe.skip;
const PORT = 5190 + Math.floor(Math.random() * 50);

run("editor (headless Chrome)", () => {
  let dir: string, server: ChildProcess, browser: Browser, page: Page;
  let serverLog = "";
  const pageErrors: string[] = [];
  const state = () => page.evaluate(() => (window as any).vizierEditor.state);
  /** Wait for a condition in the page; on timeout, fail with the editor's state, audio clock and page errors. */
  async function waitUntil<A>(what: string, fn: (arg: A) => boolean, arg: A, timeout = 20_000) {
    try { await page.waitForFunction(fn as any, arg, { timeout }); }
    catch {
      const info = await page.evaluate(() => ({ state: (window as any).vizierEditor.state, clock: (window as any).vizierEditor.clock() })).catch((e) => String(e));
      throw new Error(`timed out waiting until ${what}\n${JSON.stringify(info)}\npage errors: ${pageErrors.join(" | ") || "none"}`);
    }
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "vizier-editor-"));
    cpSync(join(root, "projects/demo/song.json"), join(dir, "song.json"));
    cpSync(join(root, "projects/demo/videos"), join(dir, "videos"), { recursive: true });
    mkdirSync(join(dir, "media"));
    for (const [n, s] of Object.entries(makeDemoTracks())) writeFileSync(join(dir, "media", `${n}.wav`), wav(s, DEMO.sampleRate));
    server = spawn(process.execPath, ["--experimental-strip-types", join(root, "apps/editor/src/server.ts"), dir, "--video", "full", "--port", String(PORT), "--no-open"], { stdio: ["ignore", "ignore", "pipe"] });
    await new Promise<void>((ok, fail) => {
      server.stderr!.on("data", (d) => { serverLog += d; if (serverLog.includes("ready:")) ok(); });
      server.on("exit", () => fail(new Error(serverLog)));
    });
    browser = await chromium.launch({ executablePath: chrome, args: ["--autoplay-policy=no-user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
    page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
    // No preview: CI machines have no GPU, the renderer is tested on its own, and these tests are about the
    // editor's transport and timeline, which must not compete with software rendering for the CPU.
    await page.goto(`http://localhost:${PORT}/?previewScale=0`);
    // ready, or an error on screen: whichever comes first, and say why if it's not ready
    try {
      await page.waitForFunction(() => { const s = (window as any).vizierEditor?.state; return s && (s.status === "ready" || s.error); }, null, { timeout: 90_000 });
    } catch { /* reported below */ }
    const s = await page.evaluate(() => (window as any).vizierEditor?.state ?? null).catch(() => null);
    if (s?.status !== "ready") throw new Error(`editor not ready: ${JSON.stringify(s)}\npage errors: ${pageErrors.join(" | ")}\nserver log:\n${serverLog}`);
  }, 120_000);

  afterAll(async () => { await browser?.close(); server?.kill(); if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("plays and stops with the space bar", async () => {
    await page.keyboard.press("Space");
    await waitUntil("time > 0.4", () => (window as any).vizierEditor.state.time > 0.4, null);
    const s = await state();
    expect(s.playing).toBe(true);
    await page.keyboard.press("Space");
    expect((await state()).playing).toBe(false);
  }, 60_000);

  it("drags a range in the ruler (snapped to beats), undoes, redoes and saves it", async () => {
    const xy = await page.evaluate(() => {
      const ed = (window as any).vizierEditor, tl = ed.timeline(), g = ed.session().doc.song.grid;
      const sec = (bar: number) => g.downbeat + ((bar - 1) * 4 * 60) / g.tempo[0].bpm;
      return { a: tl.pageX(sec(9) + 0.02), b: tl.pageX(sec(17) - 0.03), y: tl.rulerY() };
    });
    await page.mouse.move(xy.a, xy.y);
    await page.mouse.down();
    await page.mouse.move((xy.a + xy.b) / 2, xy.y, { steps: 4 });
    await page.mouse.move(xy.b, xy.y, { steps: 4 });
    await page.mouse.up();
    let s = await state();
    expect(s.range).toEqual({ from: 9, to: 17 });
    expect(s.dirtyFiles).toEqual(["videos/full.json"]);
    await page.keyboard.press("ControlOrMeta+z");
    s = await state();
    expect(s.range).toBeNull();
    expect(s.dirtyFiles).toEqual([]);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    expect((await state()).range).toEqual({ from: 9, to: 17 });
    await page.keyboard.press("ControlOrMeta+s");
    await page.waitForFunction(() => (window as any).vizierEditor.state.dirtyFiles.length === 0);
    expect(JSON.parse(readFileSync(join(dir, "videos/full.json"), "utf8")).range).toEqual({ from: 9, to: 17 });
    await page.screenshot({ path: join(root, "out/editor-e2e.png") });
  }, 90_000);

  it("sets range edges from the playhead with [ and ]", async () => {
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight"); // bar 11
    await page.keyboard.press("BracketLeft");
    expect((await state()).range.from).toBe(11);
  }, 90_000);

  it("← and ⇧← move back a bar and a beat (and → forward)", async () => {
    const sec = (bar: number) => page.evaluate((b) => { const g = (window as any).vizierEditor.session().doc.song.grid; return g.downbeat + ((b - 1) * 4 * 60) / g.tempo[0].bpm; }, bar);
    // the previous test left the playhead on bar 11
    await page.keyboard.press("ArrowLeft");
    expect((await state()).time).toBeCloseTo(await sec(10), 3);
    await page.keyboard.press("Shift+ArrowLeft");
    expect((await state()).time).toBeCloseTo(await sec(9.75), 3);
    await page.keyboard.press("ArrowRight");
    expect((await state()).time).toBeCloseTo(await sec(10), 3);
  }, 60_000);

  it("Stop leaves the playhead where it stopped; Play jumps back to the start marker; ⇧Space continues", async () => {
    const marker = (await state()).marker;
    await page.keyboard.press("Space");
    await waitUntil("playing past marker + 0.5", (m: number) => (window as any).vizierEditor.state.time > m + 0.5, marker);
    await page.keyboard.press("Space");
    let s = await state();
    expect(s.playing).toBe(false);
    const stoppedAt = s.time;
    expect(stoppedAt).toBeGreaterThan(marker + 0.4);               // stays where it stopped
    await page.waitForTimeout(300);
    expect((await state()).time).toBeCloseTo(stoppedAt, 3);         // and doesn't move
    await page.keyboard.press("Space");                             // Play: back to the marker
    await waitUntil("playing again from the marker", (st: number) => { const s = (window as any).vizierEditor.state; return s.playing && s.time < st - 0.2; }, stoppedAt);
    await page.keyboard.press("Space");
    const second = (await state()).time;
    await page.keyboard.press("Shift+Space");                       // continue from the stop point
    await page.waitForTimeout(200);
    expect((await state()).time).toBeGreaterThanOrEqual(second - 0.01);
    await page.keyboard.press("Space");
    expect((await state()).playing).toBe(false);
  }, 90_000);

  it("loops round and round, and Space stops a loop", async () => {
    const sec = (bar: number) => page.evaluate((b) => { const g = (window as any).vizierEditor.session().doc.song.grid; return g.downbeat + ((b - 1) * 4 * 60) / g.tempo[0].bpm; }, bar);
    const [a, b] = [await sec(2), await sec(3)]; // one bar, 1.875 s
    await page.evaluate(() => (window as any).vizierEditor.session().apply("test range", (d: any) => { d.videos.full.range = { from: 2, to: 3 }; }));
    try {
    const x = await page.evaluate((t) => (window as any).vizierEditor.timeline().pageX(t), a + 0.2);
    const y = await page.evaluate(() => (window as any).vizierEditor.timeline().laneY());
    await page.mouse.click(x, y);
    await page.keyboard.press("l");
    expect((await state()).loop).toBe(true);
    await page.keyboard.press("Space");
    await waitUntil("playing", () => (window as any).vizierEditor.state.playing, null);
    // watch for three times round: always playing, always inside the range (the editor counts the wraps itself,
    // so a slow test machine sampling only now and then can't miss them)
    const wraps0 = (await state()).loopWraps;
    const t0 = Date.now();
    const seen: number[] = [];
    while (Date.now() - t0 < 6500) {
      const s = await state();
      expect(s.playing).toBe(true);
      expect(s.transportPlaying).toBe(true);
      expect(s.time).toBeGreaterThanOrEqual(a - 0.01);
      expect(s.time).toBeLessThan(b + 0.15);
      seen.push(Math.round((s.time - a) * 100) / 100);
      await page.waitForTimeout(100);
    }
    const clock = await page.evaluate(() => (window as any).vizierEditor.clock());
    const wraps = (await state()).loopWraps - wraps0;
    expect(wraps, `positions seen (s into the loop): ${seen.join(" ")}\naudio clock: ${JSON.stringify(clock)}`).toBeGreaterThanOrEqual(2);
    await page.keyboard.press("Space");
    await page.waitForTimeout(400);
    expect((await state()).playing).toBe(false);
    // started after the loop, playback plays on from there (as in Ableton) instead of jumping into the loop
    const c = await sec(5);
    await page.mouse.click(await page.evaluate((t) => (window as any).vizierEditor.timeline().pageX(t), c + 0.2), y);
    const wrapsAfter = (await state()).loopWraps;
    await page.keyboard.press("Space");
    await waitUntil("playing past bar 5", (t: number) => (window as any).vizierEditor.state.time > t + 0.3, c);
    expect((await state()).loopWraps).toBe(wrapsAfter);
    await page.keyboard.press("Space");
    } finally {
      // leave things as they were for the next tests, even if this one failed
      if ((await state()).playing) await page.keyboard.press("Space");
      if ((await state()).loop) await page.keyboard.press("l");
      await page.evaluate(() => (window as any).vizierEditor.session().apply("clear test range", (d: any) => { delete d.videos.full.range; }));
    }
  }, 90_000);

  it("snap snaps clicks to beats; snap off (⌘4) puts clicks and range edges exactly where you click", async () => {
    const t = await page.evaluate(() => { const g = (window as any).vizierEditor.session().doc.song.grid; return g.downbeat + ((12.37 - 1) * 4 * 60) / g.tempo[0].bpm; });
    const x = await page.evaluate((tt) => (window as any).vizierEditor.timeline().pageX(tt), t);
    const y = await page.evaluate(() => (window as any).vizierEditor.timeline().laneY());
    // with snap on, a click lands on the nearest beat (12.25)…
    await page.mouse.click(x, y);
    expect(Math.abs((await state()).marker - (t - (0.12 * 4 * 60) / 128))).toBeLessThan(0.01);
    // …and with it off, exactly where you click
    await page.keyboard.press("ControlOrMeta+4");
    expect((await state()).snap).toBe(false);
    await page.mouse.click(x, y);
    expect(Math.abs((await state()).marker - t)).toBeLessThan(0.02);
    await page.keyboard.press("BracketLeft");
    const from = (await state()).range.from;
    expect(Math.abs(from - 12.37)).toBeLessThan(0.02);
    expect(Math.abs(from * 4 - Math.round(from * 4))).toBeGreaterThan(0.01); // not on a beat
    await page.keyboard.press("ControlOrMeta+4");
    expect((await state()).snap).toBe(true);
  }, 60_000);

  it("the preview builds its renderer once and draws one frame per video frame while playing, not one per refresh", async () => {
    // a second page with a tiny preview (enough to count the work, cheap enough for a GPU-less machine)
    const p2 = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    try {
      await p2.goto(`http://localhost:${PORT}/?previewScale=0.1`);
      await p2.waitForFunction(() => (window as any).vizierEditor?.state.status === "ready", null, { timeout: 60_000 });
      await p2.waitForFunction(() => (window as any).vizierEditor.stats().renderersBuilt > 0, null, { timeout: 30_000 });
      const before = await p2.evaluate(() => (window as any).vizierEditor.stats());
      await p2.keyboard.press("Space");
      const t0 = Date.now();
      await p2.waitForTimeout(2500);
      const after = await p2.evaluate(() => ({ ...(window as any).vizierEditor.stats(), time: (window as any).vizierEditor.state.time }));
      const secs = (Date.now() - t0) / 1000;
      await p2.keyboard.press("Space");
      expect(after.renderersBuilt - before.renderersBuilt, "renderers built while playing").toBe(0);
      expect(after.time).toBeGreaterThan(0.5);
      // the demo is 30 fps: at most one frame per video frame (+ a couple for the start)
      expect(after.previewFrames - before.previewFrames).toBeLessThanOrEqual(Math.ceil(secs * 30) + 3);
      expect(after.previewFrames - before.previewFrames).toBeGreaterThan(0);
      // an edit is applied to the running renderer: no rebuild (trails flow on), and the picture is redrawn
      const drawn = after.previewFrames;
      await p2.evaluate(() => (window as any).vizierEditor.session().apply("test edit", (d: any) => { d.videos.full.layers.find((l: any) => l.id === "ring").params = { radius: 0.2 }; }));
      await p2.waitForFunction((n) => (window as any).vizierEditor.stats().previewFrames > n, drawn, { timeout: 10_000 });
      expect((await p2.evaluate(() => (window as any).vizierEditor.stats())).renderersBuilt - before.renderersBuilt, "renderers built for an edit").toBe(0);
    } finally { await p2.close(); }
  }, 120_000);

  it("moves, resizes and rotates a layer on the preview, one undo step per gesture", async () => {
    const p3 = await browser.newPage({ viewport: { width: 1440, height: 860 } });
    const layout = () => p3.evaluate(() => (window as any).vizierEditor.session().doc.videos.full.layers.find((l: any) => l.id === "ring").layout.landscape);
    try {
      await p3.goto(`http://localhost:${PORT}/?previewScale=0.1`);
      await p3.waitForFunction(() => (window as any).vizierEditor?.state.status === "ready", null, { timeout: 60_000 });
      await p3.waitForFunction(() => (window as any).vizierEditor.stats().renderersBuilt > 0, null, { timeout: 30_000 });
      const orig = await layout();
      await p3.click('[data-layer="ring"]');
      const ov = (await p3.locator(".preview .overlay").boundingBox())!;
      const cx = ov.x + ov.width / 2, cy = ov.y + ov.height / 2;
      // drag the ring 100 px right (⇧: no snapping)
      await p3.keyboard.down("Shift");
      await p3.mouse.move(cx, cy); await p3.mouse.down();
      await p3.mouse.move(cx + 50, cy, { steps: 4 }); await p3.mouse.move(cx + 100, cy, { steps: 4 }); await p3.mouse.up();
      await p3.keyboard.up("Shift");
      const a = await layout();
      expect(a.x - orig.x).toBeCloseTo(100 / ov.width, 2);
      expect(a.w).toBe(orig.w);
      // widen it by 50 px from the right edge handle (the left edge stays put)
      const rh = (await p3.locator('[data-handle="1,0"]').boundingBox())!;
      await p3.keyboard.down("Shift");
      await p3.mouse.move(rh.x + rh.width / 2, rh.y + rh.height / 2); await p3.mouse.down();
      await p3.mouse.move(rh.x + rh.width / 2 + 50, rh.y + rh.height / 2, { steps: 5 }); await p3.mouse.up();
      await p3.keyboard.up("Shift");
      const b = await layout();
      expect(b.w - a.w).toBeCloseTo(50 / ov.width, 2);
      expect(b.x - b.w / 2).toBeCloseTo(a.x - a.w / 2, 3);
      // rotate with the knob: a quarter turn counter-clockwise (snapped to 15° steps)
      const k = (await p3.locator('[data-handle="rot"]').boundingBox())!;
      const c = { x: ov.x + b.x * ov.width, y: ov.y + b.y * ov.height };
      await p3.mouse.move(k.x + k.width / 2, k.y + k.height / 2); await p3.mouse.down();
      await p3.mouse.move(c.x - 40, c.y - 40, { steps: 4 }); await p3.mouse.move(c.x - 80, c.y, { steps: 4 }); await p3.mouse.up();
      expect((await layout()).rotation).toBe(90);
      await p3.keyboard.press("ControlOrMeta+z");
      expect((await layout()).rotation).toBeUndefined();
      await p3.keyboard.press("ControlOrMeta+z");
      expect((await layout()).w).toBe(a.w);
      await p3.keyboard.press("ControlOrMeta+z");
      expect(await layout()).toEqual(orig);
      // clicking again where layers overlap selects the next one down, then wraps round to the top
      const zOf = (id: string) => p3.evaluate((i) => (window as any).vizierEditor.session().doc.videos.full.layers.find((l: any) => l.id === i).z, id);
      const picked: string[] = [];
      for (let i = 0; i < 6; i++) {
        await p3.mouse.click(cx, cy + 5);
        picked.push(await p3.evaluate(() => (window as any).vizierEditor.state.selectedLayer));
      }
      const top = picked.indexOf(picked[0]!, 1); // the cycle length
      expect(top, `picked ${picked.join(" ")}`).toBeGreaterThan(1);
      const cycle = picked.slice(0, top);
      expect(new Set(cycle).size).toBe(cycle.length);
      const zs = await Promise.all(cycle.map(zOf));
      // after the ring (selected before), each click goes one layer further back, until it wraps to the front
      const back = zs.slice(zs.indexOf(Math.max(...zs)));
      expect([...back].sort((a, b) => b - a)).toEqual(back);
    } finally { await p3.close(); }
  }, 120_000);

  it("pops the preview out into its own window that follows the editor, edits it, and comes back when closed", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
    const main = await ctx.newPage();
    try {
      await main.goto(`http://localhost:${PORT}/?previewScale=0.1`);
      await main.waitForFunction(() => (window as any).vizierEditor?.state.status === "ready", null, { timeout: 60_000 });
      const [out] = await Promise.all([ctx.waitForEvent("page"), main.click("text=⧉ Pop out")]);
      await out.setViewportSize({ width: 1000, height: 640 });
      await main.waitForFunction(() => (window as any).vizierEditor.state.popped, null, { timeout: 15_000 });
      await out.waitForFunction(() => (window as any).vizierOutput?.state.connected, null, { timeout: 15_000 });
      expect(await main.locator(".stage").count()).toBe(0);            // the editor's own preview is gone
      expect(await main.locator("aside.inspector").count()).toBe(2);   // its room goes to the panels
      // the timeline is just tall enough for its rows (when they fit): the panels above get the rest
      const fit = await main.evaluate(() => { const c = document.querySelectorAll("section.tl canvas"); return c[0]!.getBoundingClientRect().height + c[1]!.getBoundingClientRect().height; });
      const tl = await main.locator("section.tl").evaluate((el) => el.getBoundingClientRect().height);
      expect(Math.abs(tl - Math.min(fit + 2, 860 - 42 - 24 - 140))).toBeLessThan(4);
      // the output window follows selection and the playhead; a key there plays the editor
      await main.click('[data-layer="ring"]');
      await out.waitForFunction(() => (window as any).vizierOutput.state.selected === "ring");
      await out.keyboard.press("Space");
      await main.waitForFunction(() => (window as any).vizierEditor.state.time > 0.5, null, { timeout: 20_000 });
      await out.waitForFunction(() => (window as any).vizierOutput.state.time > 0.5, null, { timeout: 20_000 });
      await out.keyboard.press("Space");
      expect(await main.evaluate(() => (window as any).vizierEditor.state.playing)).toBe(false);
      // dragging the ring there moves it in the editor's video
      const x0 = await main.evaluate(() => (window as any).vizierEditor.session().doc.videos.full.layers.find((l: any) => l.id === "ring").layout.landscape.x);
      const ov = (await out.locator(".overlay").boundingBox())!;
      await out.keyboard.down("Shift");
      await out.mouse.move(ov.x + ov.width / 2, ov.y + ov.height / 2); await out.mouse.down();
      await out.mouse.move(ov.x + ov.width / 2 + 100, ov.y + ov.height / 2, { steps: 5 }); await out.mouse.up();
      await out.keyboard.up("Shift");
      const x1 = await main.evaluate(() => (window as any).vizierEditor.session().doc.videos.full.layers.find((l: any) => l.id === "ring").layout.landscape.x);
      expect(x1 - x0).toBeCloseTo(100 / ov.width, 2);
      // ⌘Z pressed in the output window undoes it in the editor
      await out.keyboard.press("ControlOrMeta+z");
      await main.waitForFunction((x) => (window as any).vizierEditor.session().doc.videos.full.layers.find((l: any) => l.id === "ring").layout.landscape.x === x, x0);
      // closing it brings the preview back
      await out.close();
      await main.waitForFunction(() => !(window as any).vizierEditor.state.popped, null, { timeout: 6000 });
      await main.waitForTimeout(1500);
      expect(await main.evaluate(() => (window as any).vizierEditor.state.popped)).toBe(false);
      expect(await main.locator(".stage .preview").count()).toBe(1);
    } finally { await ctx.close(); }
  }, 120_000);

  it("preview quality: a choice per window, remembered; the preview is redrawn at that size", async () => {
    const p4 = await browser.newPage({ viewport: { width: 1440, height: 860 } });
    try {
      await p4.goto(`http://localhost:${PORT}/`);
      await p4.waitForFunction(() => (window as any).vizierEditor?.state.status === "ready", null, { timeout: 60_000 });
      await p4.waitForFunction(() => (window as any).vizierEditor.stats().renderersBuilt > 0, null, { timeout: 60_000 });
      expect(await p4.locator(".preview .label").textContent()).toContain("960×540");
      const built = await p4.evaluate(() => (window as any).vizierEditor.stats().renderersBuilt);
      await p4.selectOption('select[aria-label="Preview quality"]', "0.25");
      await p4.waitForFunction((n) => (window as any).vizierEditor.stats().renderersBuilt > n, built, { timeout: 30_000 });
      expect(await p4.locator(".preview .label").textContent()).toContain("480×270");
      await p4.reload();
      await p4.waitForFunction(() => (window as any).vizierEditor?.state.status === "ready", null, { timeout: 60_000 });
      expect(await p4.inputValue('select[aria-label="Preview quality"]')).toBe("0.25");
      await p4.evaluate(() => localStorage.removeItem("vizier.previewQuality.in"));
    } finally { await p4.close(); }
  }, 180_000);

  it("I shows frame timing", async () => {
    await page.keyboard.press("i");
    await page.waitForTimeout(800);
    expect(await page.locator(".perf").textContent()).toMatch(/\d+ Hz · late/);
    expect((await page.evaluate(() => (window as any).vizierEditor.stats())).hz).toBeGreaterThan(0);
    await page.keyboard.press("i");
    expect(await page.locator(".perf").count()).toBe(0);
  }, 30_000);

  it("⌘ + swipe up zooms in (as in Ableton on a Mac); pinch-spread zooms in", async () => {
    const tl = () => page.evaluate(() => (window as any).vizierEditor.timeline().zoomLevel());
    const y = await page.evaluate(() => (window as any).vizierEditor.timeline().laneY());
    const x = await page.evaluate(() => (window as any).vizierEditor.timeline().pageX(10));
    const wheel = (deltaY: number, metaKey: boolean, ctrlKey: boolean) => page.evaluate(({ x, y, deltaY, metaKey, ctrlKey }) => {
      document.elementFromPoint(x, y)!.dispatchEvent(new WheelEvent("wheel", { deltaY, metaKey, ctrlKey, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    }, { x, y, deltaY, metaKey, ctrlKey });
    const z0 = await tl();
    await wheel(40, true, false);
    const z1 = await tl();
    expect(z1).toBeGreaterThan(z0);
    await wheel(-40, false, true); // pinch spread
    const z2 = await tl();
    expect(z2).toBeGreaterThan(z1);
    await page.keyboard.press("Shift+Equal"); // "+"
    expect(await tl()).toBeGreaterThan(z2);
    await page.keyboard.press("0");
  }, 30_000);

  it("keeps the header and side panel in view when the window gets smaller again", async () => {
    await page.setViewportSize({ width: 1800, height: 900 });
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.waitForTimeout(500);
    const save = await page.locator("header button", { hasText: "Save" }).boundingBox();
    expect(save!.x + save!.width).toBeLessThanOrEqual(1100);
    const aside = await page.locator("aside.inspector").boundingBox();
    expect(aside!.x + aside!.width).toBeLessThanOrEqual(1101);
    await page.setViewportSize({ width: 1440, height: 860 });
  }, 30_000);

  it("scrolls tracks and layers under a fixed ruler, and draws the last rows", async () => {
    await page.setViewportSize({ width: 1440, height: 700 }); // a short window: the rows don't all fit
    try {
      await page.waitForTimeout(300);
      const ruler0 = await page.evaluate(() => (window as any).vizierEditor.timeline().rulerY());
      // the last layer row, scrolled into view: the tracks canvas is what's under the pointer there (not clipped)
      const lastId = await page.evaluate(() => [...document.querySelectorAll(".h.layer")].at(-1)!.getAttribute("title"));
      const layers = await page.evaluate(() => (window as any).vizierEditor.session().doc.videos.full.layers.map((l: any) => [l.id, l.name]));
      const id = layers.find((l: string[]) => l[1] === lastId)![0];
      const y = await page.evaluate((i) => (window as any).vizierEditor.timeline().layerY(i), id);
      expect(await page.evaluate(() => document.querySelector(".scroller")!.scrollTop)).toBeGreaterThan(0);
      const x = await page.evaluate(() => (window as any).vizierEditor.timeline().pageX(5));
      expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest(".wrap2") !== null, { x, y })).toBe(true);
      expect(await page.evaluate(() => (window as any).vizierEditor.timeline().rulerY())).toBe(ruler0);
    } finally {
      await page.evaluate(() => { document.querySelector(".scroller")!.scrollTop = 0; });
      await page.setViewportSize({ width: 1440, height: 860 });
    }
  }, 30_000);

  it("resizes the timeline from the grip on its top edge; double-click fits its rows", async () => {
    const tlH = () => page.locator("section.tl").evaluate((el) => el.getBoundingClientRect().height);
    const h0 = await tlH();
    const g = (await page.locator(".grip").boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + 3); await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2, g.y - 50, { steps: 4 }); await page.mouse.move(g.x + g.width / 2, g.y - 80, { steps: 4 }); await page.mouse.up();
    expect(await tlH()).toBeCloseTo(h0 + 80, -1);
    await page.dblclick(".grip");
    const fit = await page.evaluate(() => { const c = document.querySelectorAll("section.tl canvas"); return c[0]!.getBoundingClientRect().height + c[1]!.getBoundingClientRect().height + 2; });
    expect(Math.abs((await tlH()) - Math.min(fit + 1, 860 - 42 - 24 - 140))).toBeLessThan(4);
    await page.evaluate(() => { localStorage.removeItem("vizier.timelineHeight.in"); });
  }, 30_000);

  it("long names never push the timeline out of line with the ruler", async () => {
    const startLabel = (await state()).undoLabel;
    try {
      await page.evaluate(() => (window as any).vizierEditor.session().apply("long name", (d: any) => { d.videos.full.layers.find((l: any) => l.id === "ring").name = "A really very long layer name that can't fit"; }));
      await page.click('[data-fold="ring"]');
      const left = (sel: string) => page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().left);
      expect(await left("section.tl .scroller canvas")).toBe(await left("section.tl .top canvas"));
      const h = await page.locator(".h.layer", { hasText: "A really" }).evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, to: getComputedStyle(el).textOverflow }));
      expect(h.to).toBe("ellipsis");
      expect(h.sw).toBeGreaterThan(h.cw); // cut off with …, not widening the column
    } finally {
      for (let i = 0; i < 5 && (await state()).undoLabel !== startLabel; i++) await page.evaluate(() => (window as any).vizierEditor.session().undo());
      if ((await state()).shownLanes.some((t: string) => t.startsWith("ring."))) await page.click('[data-fold="ring"]');
    }
  }, 30_000);

  it("shows the shortcuts with ?", async () => {
    await page.keyboard.press("Shift+Slash");
    expect(await page.locator("text=Keyboard shortcuts").count()).toBeGreaterThan(0);
    expect(await page.locator("text=Close the shortcuts window").count()).toBe(1);
    expect(await page.locator(".row", { hasText: "Zoom in" }).count()).toBe(1);
    expect((await page.locator(".row", { hasText: "Zoom in" }).locator(".keys").textContent())?.trim()).toBe("+");
    await page.keyboard.press("Escape");
    expect(await page.locator("text=Keyboard shortcuts").count()).toBe(0);
  }, 60_000);

  it("switches generators at a bar: split the ring there, drop its second half, add a grid on from there", async () => {
    const E = <A,>(f: (a: A) => unknown, a?: A) => page.evaluate(f as any, a);
    const startLabel = (await state()).undoLabel;
    const spansOf = (id: string) => E((i) => (window as any).vizierEditor.session().doc.videos.full.layers.find((l: any) => l.id === i)?.spans, id);
    try {
      // playhead to bar 17
      const sec17 = (await E(() => { const g = (window as any).vizierEditor.session().doc.song.grid; return g.downbeat + (16 * 4 * 60) / g.tempo[0].bpm; })) as number;
      await page.mouse.click(await E((t) => (window as any).vizierEditor.timeline().pageX(t), sec17 + 0.05) as number, await E(() => (window as any).vizierEditor.timeline().laneY()) as number);
      await page.click('[data-layer="ring"]');
      expect((await state()).selectedLayer).toBe("ring");
      await page.keyboard.press("ControlOrMeta+e");
      const split = await spansOf("ring") as { from: number; to?: number }[];
      expect(split.map((s) => s.to)).toEqual([17, undefined]);
      expect(split[1]!.from).toBe(17);
      // click the second half in the ring's timeline row, delete it
      const ly = await E(() => (window as any).vizierEditor.timeline().layerY("ring")) as number;
      await page.mouse.click(await E((t) => (window as any).vizierEditor.timeline().pageX(t), sec17 + 5) as number, ly);
      expect((await state()).selectedSpan).toBe(1);
      await page.keyboard.press("Backspace");
      expect((await spansOf("ring") as unknown[]).length).toBe(1);
      // a Pulse grid on the bass track, on from the playhead
      await page.selectOption('select[aria-label="Add a layer"]', "pulseGrid");
      expect((await state()).selectedLayer).toBe("pulseGrid");
      await page.selectOption('select[aria-label="Track"]', "bass");
      await page.click("text=On from playhead");
      expect(await spansOf("pulseGrid")).toEqual([{ from: 17 }]);
      // drag a slider: one undo step
      const slider = page.locator('input[aria-label="Brightness slider"]');
      await slider.scrollIntoViewIfNeeded();
      const box = (await slider.boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 6 });
      await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 6 });
      await page.mouse.up();
      expect((await state()).undoLabel).toBe("brightness");
      await page.keyboard.press("ControlOrMeta+z");
      expect((await state()).undoLabel).toBe("on from playhead");
      // ⌘D duplicates the selected layer and selects the copy
      await page.keyboard.press("ControlOrMeta+d");
      expect((await state()).selectedLayer).toBe("pulseGrid-2");
      expect(await spansOf("pulseGrid-2")).toEqual([{ from: 17 }]);
    } finally {
      for (let i = 0; i < 20 && (await state()).undoLabel !== startLabel; i++) await E(() => (window as any).vizierEditor.session().undo());
      await page.keyboard.press("Escape");
    }
  }, 90_000);

  it("in a reel: marks and resets what it changes, restores a removed layer; makes, saves and undoes a new video", async () => {
    const E = <A,>(f: (a: A) => unknown, a?: A) => page.evaluate(f as any, a);
    const startLabel = (await state()).undoLabel;
    try {
      await page.selectOption("header select", "reel");
      await page.waitForFunction(() => (window as any).vizierEditor.state.videoName === "reel");
      const tag = (id: string) => page.locator(`[data-layer="${id}"] .tag`).textContent();
      expect(await tag("ring")).toBe("base");
      expect(await tag("caption")).toBe("added");
      // change the ring's radius here: it's marked, and ↺ takes it back to the full video's value
      await page.click('[data-layer="ring"]');
      const box = page.locator('input[aria-label="Radius"]');
      await box.fill("1.5"); await box.press("Enter"); await box.blur();
      expect(await tag("ring")).toBe("changed");
      expect(await E(() => (window as any).vizierEditor.session().doc.videos.full.layers.find((l: any) => l.id === "ring").params?.radius)).not.toBe(1.5);
      await page.click('button[aria-label="Reset Radius to base"]');
      expect(await tag("ring")).toBe("base");
      // remove an inherited layer, then restore it
      await page.click('[data-layer="title"] button[title="Remove"]');
      expect(await page.locator('[data-removed="title"]').count()).toBe(1);
      await page.click('[data-removed="title"] button');
      expect(await tag("title")).toBe("base");
      // a new Short built on the reel: opened, saved to its own file
      await page.click("text=+ New");
      await page.fill('input[aria-label="New video name"]', "Short: the break");
      await page.selectOption('select[aria-label="New video format"]', "shorts");
      await page.click('button[type="submit"]');
      await page.waitForFunction(() => (window as any).vizierEditor.state.videoName === "short-the-break");
      expect(await page.locator("text=YouTube Shorts").count()).toBeGreaterThan(0);
      await page.keyboard.press("ControlOrMeta+s");
      await page.waitForFunction(() => (window as any).vizierEditor.state.dirtyFiles.length === 0);
      expect(JSON.parse(readFileSync(join(dir, "videos/short-the-break.json"), "utf8"))).toMatchObject({ base: "reel", format: "shorts" });
      // undoing "new video" while it's open goes back to a video that exists
      await page.keyboard.press("ControlOrMeta+z");
      await page.waitForFunction(() => (window as any).vizierEditor.state.videoName !== "short-the-break");
    } finally {
      for (let i = 0; i < 20 && (await state()).undoLabel !== startLabel; i++) await E(() => (window as any).vizierEditor.session().undo());
      await page.selectOption("header select", "full");
    }
  }, 120_000);

  it("automation: unfold a layer's lanes, add, move and delete breakpoints, set a curve, automate from the panel", async () => {
    const E = <A,>(f: (a: A) => unknown, a?: A) => page.evaluate(f as any, a);
    const startLabel = (await state()).undoLabel;
    const lane = (t: string) => E((tt) => (window as any).vizierEditor.session().doc.videos.full.automation?.find((a: any) => a.target === tt)?.points, t);
    const sec = (bar: number) => E((b) => { const g = (window as any).vizierEditor.session().doc.song.grid; return g.downbeat + ((b - 1) * 4 * 60) / g.tempo[0].bpm; }, bar) as Promise<number>;
    const xy = async (t: string, s: number, v: number) => (await E(([tt, ss, vv]) => (window as any).vizierEditor.timeline().laneXY(tt, ss, vv), [t, s, v] as const)) as { x: number; y: number };
    try {
      const before = await lane("ring.radius") as unknown[];
      await page.click('[data-fold="ring"]');
      expect((await state()).shownLanes).toContain("ring.radius");
      let p = await xy("ring.radius", (await sec(20)) + 0.05, 1.5);
      await page.mouse.click(p.x, p.y);
      expect((await lane("ring.radius") as any[]).length).toBe(before.length + 1);
      expect((await state()).selectedPoint).toEqual({ target: "ring.radius", index: 1 });
      // drag it to bar 22
      p = await xy("ring.radius", await sec(20), 1.5);
      const to = await xy("ring.radius", await sec(22), 1.5);
      await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up();
      expect((await lane("ring.radius") as any[])[1].bar).toBe(22);
      await page.click('[data-lane="ring.radius"] button[title^="Ease"]');
      expect((await lane("ring.radius") as any[])[1].curve).toBe("smooth");
      await page.keyboard.press("Backspace");
      expect(await lane("ring.radius")).toEqual(before);
      // automate a parameter from the panel: a lane appears at the playhead with the current value
      await page.click('[data-layer="ring"]');
      const a = page.locator('button[aria-label="Automate Spectrum spikes"]');
      await a.scrollIntoViewIfNeeded(); await a.click();
      expect((await lane("ring.spike") as any[]).length).toBe(1);
      expect(await page.locator('[data-lane="ring.spike"]').count()).toBe(1);
      expect(await a.evaluate((el) => el.classList.contains("on"))).toBe(true);
      // A again hides it (the lane stays); the lane header's – hides one too; ▸ shows all the layer's lanes
      await a.click();
      expect(await page.locator('[data-lane="ring.spike"]').count()).toBe(0);
      expect((await lane("ring.spike") as any[]).length).toBe(1);
      await page.click('[data-lane="ring.radius"] button[aria-label="Hide lane"]');
      expect(await page.locator('[data-lane="ring.radius"]').count()).toBe(0);
      await page.click('[data-fold="ring"]');
      expect(await page.locator('[data-lane="ring.radius"], [data-lane="ring.spike"]').count()).toBe(2);
      await page.click('[data-fold="ring"]');
      expect(await page.locator("[data-lane]").count()).toBe(0);
      // removing a lane un-lights its A; A then starts a new one (rather than "hiding" one that's gone)
      await a.click();
      await page.click('[data-lane="ring.spike"] button[title="Remove this lane"]');
      expect(await a.evaluate((el) => el.classList.contains("on"))).toBe(false);
      await a.click();
      expect((await lane("ring.spike") as any[]).length).toBe(1);
      expect(await a.evaluate((el) => el.classList.contains("on"))).toBe(true);
    } finally {
      for (let i = 0; i < 20 && (await state()).undoLabel !== startLabel; i++) await E(() => (window as any).vizierEditor.session().undo());
      if ((await state()).shownLanes.some((t: string) => t.startsWith("ring."))) await page.click('[data-fold="ring"]');
    }
  }, 90_000);

  it("audio modulation: M adds one; its meter follows the music while playing; it's saved in the video", async () => {
    const E = <A,>(f: (a: A) => unknown, a?: A) => page.evaluate(f as any, a);
    const startLabel = (await state()).undoLabel;
    try {
      await page.click('[data-layer="title"]');
      const m = page.locator('button[aria-label="Modulate Blur"]');
      await m.scrollIntoViewIfNeeded(); await m.click();
      expect(await E(() => (window as any).vizierEditor.session().doc.videos.full.modulations.find((x: any) => x.target === "title.blur"))).toMatchObject({ source: "mix.env" });
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("Space");
      await page.waitForFunction(() => Number(document.querySelector('[data-mod="mix.env"] .fill')?.getAttribute("data-level")) > 0.1, null, { timeout: 20_000 });
      await page.keyboard.press("Space");
    } finally {
      if ((await state()).playing) await page.keyboard.press("Space");
      for (let i = 0; i < 10 && (await state()).undoLabel !== startLabel; i++) await E(() => (window as any).vizierEditor.session().undo());
    }
  }, 60_000);

  it("switches videos and shows the reel in its own format", async () => {
    await page.selectOption("header select", "reel");
    await page.waitForFunction(() => (window as any).vizierEditor.state.videoName === "reel");
    expect(await page.locator("text=Instagram Reels").count()).toBeGreaterThan(0);
  }, 90_000);
});
