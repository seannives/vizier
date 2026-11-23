// Drives the editor in headless Chrome against a temporary copy of the demo project.
// Shortcuts use ControlOrMeta: ⌘ on a Mac, Ctrl elsewhere, matching the editor.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";
import { DEMO, makeDemoTracks, wav } from "../../../scripts/demo-audio.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const chrome = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find((p) => p && existsSync(p));
// VIZIER_QUICK=1 (pnpm test:quick) skips the tests that drive Chrome
const run = chrome && !process.env.VIZIER_QUICK ? describe : describe.skip;
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
    server = spawn(process.execPath, ["--experimental-strip-types", join(root, "apps/editor/src/server.ts"), dir, "--video", "full", "--port", String(PORT), "--no-open"], { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, VIZIER_RENDER_GPU: "0", VIZIER_NO_REVEAL: "1" } });
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
      // (on a busy machine, such as CI running the render tests alongside, software GL can take seconds per frame:
      // wait for frames to arrive rather than assume they do in 2.5 s; the limit below uses the real time taken)
      await p2.waitForFunction((n) => (window as any).vizierEditor.stats().previewFrames > n + 1, before.previewFrames, { timeout: 60_000 });
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
      await main.waitForFunction(() => !(window as any).vizierEditor.state.popped, null, { timeout: 30_000 }); // (a busy machine delays the goodbye)
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

  it("the layer's name stays at the top of the panel when it scrolls; the panel widens into room the preview doesn't use", async () => {
    await page.click('[data-layer="ring"]');
    const insp = page.locator("aside.inspector").first();
    await insp.evaluate((el) => (el.scrollTop = 600));
    await page.waitForTimeout(100);
    const top = await insp.evaluate((el) => el.getBoundingClientRect().top);
    const title = await page.locator(".panel .title").evaluate((el) => el.getBoundingClientRect().top);
    expect(Math.abs(title - top)).toBeLessThan(3);
    await insp.evaluate((el) => (el.scrollTop = 0));
    // (the preview is off in these tests, so the stage needs no room: the panel takes its widest)
    expect(await insp.evaluate((el) => el.getBoundingClientRect().width)).toBe(600);
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
      await page.click('[data-layer="title"] button.rm');
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
      // ▸ with some of its lanes shown (its colour lane) hides them all; again shows them all
      const ringLanes = '[data-lane^="ring."]';
      if (await page.locator(ringLanes).count()) await page.click('[data-fold="ring"]');
      expect(await page.locator(ringLanes).count()).toBe(0);
      await page.click('[data-fold="ring"]');
      expect(await page.locator('[data-lane="ring.radius"], [data-lane="ring.spike"]').count()).toBe(2);
      await page.click('[data-fold="ring"]');
      expect(await page.locator(ringLanes).count()).toBe(0);
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

  it("buttons that have a keyboard shortcut show it in their tooltip", async () => {
    await page.click('[data-layer="ring"]');                                  // (the layer panel's buttons)
    const titles = await page.evaluate(() => [...document.querySelectorAll("button[title]")].map((b) => b.getAttribute("title")!));
    const has = (start: string, keys: string) => titles.some((t) => t.startsWith(start) && t.includes(keys));
    const mac = await page.evaluate(() => /Mac/.test(navigator.platform));
    const k = (mods: string, key: string) => (mac ? mods.replace("Mod", "⌘").replace("Shift", "⇧") : mods.replace("Mod", "Ctrl+").replace("Shift", "Shift+")) + key;
    const want: [string, string][] = [["Play / stop", "Space"], ["Loop the range", "L"], ["Snap to the beat", k("Mod", "4")], ["Undo", k("Mod", "Z")],
      ["Redo", k("ShiftMod", "Z")], ["Save", k("Mod", "S")], ["Keyboard shortcuts", "?"], ["Duplicate", k("Mod", "D")], ["Split at the playhead", k("Mod", "E")]];
    expect(want.filter(([start, keys]) => !has(start, keys))).toEqual([]);
  }, 60_000);

  it("opening a video puts the playhead at the start of its range", async () => {
    if ((await state()).playing) await page.keyboard.press("Space");
    await page.selectOption("header select", "full");
    await page.waitForFunction(() => (window as any).vizierEditor.state.videoName === "full");
    await page.selectOption("header select", "reel");                      // the reel is bars 21–31
    await waitUntil("the playhead is at bar 21", () => {
      const ed = (window as any).vizierEditor, g = ed.session().doc.song.grid;
      return Math.abs(ed.state.time - (g.downbeat + (20 * 4 * 60) / g.tempo[0].bpm)) < 0.01;
    }, null);
  }, 90_000);

  it("tracks: drop a file to add a track, drop on a track to replace it, saving moves the files into media/", async () => {
    // a new bounce of the drums, 0.5 s late (as if bounced from the wrong start), and a copy of the pad
    const t = makeDemoTracks(), late = new Float32Array(t.drums.length);
    late.set(t.drums.subarray(0, t.drums.length - DEMO.sampleRate / 2), DEMO.sampleRate / 2);
    const drop = async (target: string, name: string, bytes: Buffer) => {
      await page.evaluate(async ({ target, name, b64 }) => {
        const bin = atob(b64), u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const dt = new DataTransfer();
        dt.items.add(new File([u], name, { type: "audio/wav" }));
        const el = document.querySelector(target)!;
        el.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
        el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      }, { target, name, b64: bytes.toString("base64") });
    };
    const tracks = () => page.evaluate(() => (window as any).vizierEditor.session().doc.song.tracks as { id: string; name: string; file: string }[]);
    // dropped on the preview: a new track, named after the file, waiting until saved
    await drop("main", "Pad copy.wav", wav(t.pad, DEMO.sampleRate));
    await page.waitForFunction(() => (window as any).vizierEditor.session().doc.song.tracks.some((t: any) => t.id === "pad-copy"));
    expect((await tracks()).find((x) => x.id === "pad-copy")!.file).toMatch(/^media\/\.incoming\/\d+\/Pad copy\.wav$/);
    // dropped on the drums' row in the timeline: replaces its audio; the panel warns it's late against the mix
    await drop('.heads [data-track="drums"]', "drums v2.wav", wav(late, DEMO.sampleRate));
    await page.waitForFunction(() => (window as any).vizierEditor.session().doc.song.tracks.find((t: any) => t.id === "drums").file.includes(".incoming"));
    if (!(await page.locator(".tracks").count())) await page.click("button.fold-btn");
    await page.waitForSelector('.tracks [data-track="drums"] .warn', { timeout: 30_000 });
    expect(await page.textContent('.tracks [data-track="drums"] .warn')).toMatch(/0\.50 s late/);
    // saving: the files move into media/, the song points at them, the replaced drums file is gone
    await page.keyboard.press("ControlOrMeta+s");
    await page.waitForFunction(() => !(window as any).vizierEditor.state.dirtyFiles.includes("song.json"));
    const saved = JSON.parse(readFileSync(join(dir, "song.json"), "utf8")) as { tracks: { id: string; file: string }[] };
    expect(saved.tracks.find((x) => x.id === "pad-copy")!.file).toBe("media/Pad copy.wav");
    expect(saved.tracks.find((x) => x.id === "drums")!.file).toBe("media/drums v2.wav");
    expect(existsSync(join(dir, "media/drums v2.wav"))).toBe(true);
    expect(existsSync(join(dir, "media/drums.wav"))).toBe(false);
    expect((await tracks()).find((x) => x.id === "drums")!.file).toBe("media/drums v2.wav");
    // removing a track: its layers go to the mix
    await page.click('.tracks [data-track="pad-copy"] button.rm');
    expect((await tracks()).some((x) => x.id === "pad-copy")).toBe(false);
  }, 120_000);

  it("tempo: set BPM and beats per bar, add a change, slide the grid (⌥-drag, bar line to playhead), the click", async () => {
    const grid = () => page.evaluate(() => (window as any).vizierEditor.session().doc.song.grid);
    if (!(await page.locator(".tempo").count())) await page.click('button.fold-btn:has-text("Tempo")');
    // the mix's tempo is worked out and offered (the demo is 128 BPM)
    await page.waitForSelector(".tempo .detected button.best", { timeout: 60_000 });
    expect(await page.textContent(".tempo .detected button.best")).toBe("128");
    await page.fill('input[aria-label="BPM from bar 1"]', "130"); await page.press('input[aria-label="BPM from bar 1"]', "Tab");
    expect((await grid()).tempo[0].bpm).toBe(130);
    await page.click(".tempo .detected button.best");                       // back to what the mix says
    expect((await grid()).tempo[0].bpm).toBe(128);
    // a change at the playhead's bar: 3 beats a bar from there
    await page.evaluate(() => { const ed = (window as any).vizierEditor, g = ed.session().doc.song.grid; ed.seek(g.downbeat + (8 * 4 * 60) / 128); });
    await page.click('.tempo button:has-text("+ Change at bar 9")');
    await page.fill('input[aria-label="Beats per bar from bar 9"]', "3"); await page.press('input[aria-label="Beats per bar from bar 9"]', "Tab");
    expect((await grid()).tempo).toEqual([{ bar: 1, bpm: 128, beatsPerBar: 4 }, { bar: 9, bpm: 128, beatsPerBar: 3 }]);
    await page.click('[data-tempo-bar="9"] button.x');
    expect((await grid()).tempo).toHaveLength(1);
    // ⌥-drag in the ruler slides the grid by the time dragged, as one undo step
    const before = (await grid()).downbeat;
    const xy = await page.evaluate(() => { const tl = (window as any).vizierEditor.timeline(); return { a: tl.pageX(10), b: tl.pageX(10.25), y: tl.rulerY() }; });
    await page.keyboard.down("Alt");
    await page.mouse.move(xy.a, xy.y); await page.mouse.down();
    await page.mouse.move((xy.a + xy.b) / 2, xy.y, { steps: 3 }); await page.mouse.move(xy.b, xy.y, { steps: 3 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    expect((await grid()).downbeat).toBeCloseTo(before + 0.25, 1);
    expect((await state()).undoLabel).toBe("move the grid");
    await page.keyboard.press("ControlOrMeta+z");
    expect((await grid()).downbeat).toBeCloseTo(before, 3);
    // bar line to playhead: the bar line nearest the playhead moves onto it
    await page.evaluate(() => { const ed = (window as any).vizierEditor, g = ed.session().doc.song.grid; ed.seek(g.downbeat + (4 * 4 * 60) / 128 + 0.04); });
    await page.click('.tempo button:has-text("Bar line to playhead")');
    expect((await grid()).downbeat).toBeCloseTo(before + 0.04, 3);
    await page.keyboard.press("ControlOrMeta+z");
    // the click: C turns it on; playing schedules a tick on every beat, the first of each bar marked
    await page.keyboard.press("c");
    await page.keyboard.press("Space");
    await page.waitForFunction(() => (window as any).vizierEditor.clicks().beats >= 4, null, { timeout: 20_000 });
    await page.keyboard.press("Space");
    await page.keyboard.press("c");
    const c = await page.evaluate(() => (window as any).vizierEditor.clicks());
    expect(c.downbeats).toBeGreaterThanOrEqual(1);
    expect(c.beats / Math.max(1, c.downbeats)).toBeGreaterThan(1.5);          // about 3 beats to each downbeat
  }, 120_000);

  it("colour: the palette (song or this video), a layer's colour (a slot or its own), colour lanes with the picker", async () => {
    const d = () => page.evaluate(() => (window as any).vizierEditor.session().doc);
    const typeHex = async (hex: string) => { await page.fill('[aria-label="Hex colour"]', hex); await page.press('[aria-label="Hex colour"]', "Enter"); };
    await page.selectOption("header select", "full");
    await page.waitForFunction(() => (window as any).vizierEditor.state.videoName === "full");
    // the palette: a slot for the song, then for this video only, then back
    if (!(await page.locator(".palette").count())) await page.click('button.fold-btn:has-text("Palette")');
    await page.click('[data-slot="extra1"] button.sw');
    await page.waitForSelector('[role="dialog"][aria-label="Palette: Extra 1"]');
    await typeHex("#ff0000");
    expect((await d()).song.palette.extra1).toBe("#ff0000");
    await page.check('[role="dialog"] input[type="checkbox"]');                   // only in this video
    await typeHex("#00ff00");
    expect((await d()).song.palette.extra1).toBe("#ff0000");
    expect((await d()).videos.full.palette.extra1).toBe("#00ff00");
    await page.uncheck('[role="dialog"] input[type="checkbox"]');
    expect((await d()).videos.full.palette?.extra1).toBeUndefined();
    await page.keyboard.press("Escape");
    expect(await page.locator('[role="dialog"]').count()).toBe(0);
    // a layer's colour: follow another slot, then its own
    await page.click('[data-layer="ring"]');
    const sw = page.locator('[data-colour="highlight"] button.sw');
    await sw.scrollIntoViewIfNeeded(); await sw.click();
    await page.click('[role="dialog"] button[aria-label="Extra 2"]');
    expect((await d()).videos.full.layers.find((l: any) => l.id === "ring").colors.highlight).toBe("extra2");
    await typeHex("#123456");
    expect((await d()).videos.full.layers.find((l: any) => l.id === "ring").colors.highlight).toBe("#123456");
    await page.keyboard.press("Escape");
    // a colour lane: A starts it at the playhead with the colour; a click adds a point (the same colour there);
    // a double-click picks its colour; the long way round
    await page.evaluate(() => (window as any).vizierEditor.seek(0));
    await page.click('button[aria-label="Automate Highlight (open filter)"]');
    const lane = async () => (await d()).videos.full.automation.find((a: any) => a.target === "ring.highlight").points;
    expect(await lane()).toEqual([{ bar: expect.any(Number), c: "#123456" }]);
    await page.waitForSelector('[data-lane="ring.highlight"]');
    const at = async (bar: number) => page.evaluate((bar) => { const ed = (window as any).vizierEditor, g = ed.session().doc.song.grid; return ed.timeline().laneXY("ring.highlight", g.downbeat + ((bar - 1) * 4 * 60) / g.tempo[0].bpm, 0.5); }, bar);
    let p = await at(9);
    await page.mouse.click(p.x, p.y);
    expect((await lane()).map((x: any) => [x.bar, x.c])).toEqual([[expect.any(Number), "#123456"], [9, "#123456"]]);
    p = await at(9);
    await page.mouse.dblclick(p.x, p.y);
    await page.waitForSelector('[role="dialog"][aria-label^="Highlight (open filter) colour"]');
    await typeHex("#ff00ff");
    expect((await lane())[1].c).toBe("#ff00ff");
    await page.keyboard.press("Escape");
    // the long way: on the first point (the fade after it)
    p = await at((await lane())[0].bar);                                         // (the lane starts at the playhead: time 0)
    await page.mouse.dblclick(p.x, p.y);
    await page.check('[role="dialog"] input[type="checkbox"]');
    expect((await lane())[0].hue).toBe("long");
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => (window as any).vizierEditor.state.undoLabel)).toBe("colour automation");
    // the video's own lanes (palette, post) sit under "Palette & picture"
    await page.click('[data-fold="_video"]');
    expect(await page.locator('[data-lane="palette.accent"]').count()).toBe(1);
  }, 120_000);

  it("render: asks to save first; renders with progress and can cancel; lists, plays and shows past renders", async () => {
    // a past render, with the snapshot the command writes beside it
    mkdirSync(join(dir, "output"), { recursive: true });
    writeFileSync(join(dir, "output/full-youtube.mp4"), readFileSync(join(root, "apps/editor/test/fixtures/tiny.mp4")));
    writeFileSync(join(dir, "output/full-youtube.json"), JSON.stringify({ renderedAt: new Date().toISOString(), video: "full", profile: "youtube", range: { fromSeconds: 0, toSeconds: 1, frames: 30 }, vizier: { commit: "abc1234", localChanges: false } }));
    await page.selectOption("header select", "full");
    await page.waitForFunction(() => (window as any).vizierEditor.state.videoName === "full");
    await page.selectOption('select[aria-label="Add a layer"]', "pulseGrid");        // an unsaved change
    await page.click("header button.render");
    await page.waitForSelector('[role="dialog"][aria-label="Render"]');
    expect(await page.textContent('[aria-label="Render"] .warn')).toMatch(/save first/);
    expect(await page.isDisabled('[aria-label="Render"] button.primary')).toBe(true);
    await page.click('[aria-label="Render"] .warn button');                             // Save
    await page.waitForFunction(() => !document.querySelector('[aria-label="Render"] .warn'));
    // the past render: listed with its format, length and version; Play shows it; Show in Finder asks the server
    const row = '[aria-label="Render"] li[data-file="output/full-youtube.mp4"]';
    await page.waitForSelector(row);
    expect(await page.textContent(row)).toMatch(/YouTube.*0:01.*abc1234/);
    await page.click(`${row} button:has-text("Play")`);
    expect(await page.getAttribute('[aria-label="Render"] video', "src")).toBe("/api/output?file=output%2Ffull-youtube.mp4");
    const r = await page.evaluate(async () => { const x = await fetch("/api/output?file=output%2Ffull-youtube.mp4", { headers: { range: "bytes=0-99" } }); return { status: x.status, len: (await x.arrayBuffer()).byteLength }; });
    expect(r).toEqual({ status: 206, len: 100 });                                       // ranges, so the player can seek
    await page.click('[aria-label="Render"] button:has-text("Close the player")');
    await page.click(`${row} button:has-text("Show in Finder")`);
    // a render: progress shows (here, without a GPU, slowly), then Cancel stops it and leaves no file behind
    await page.click('[aria-label="Render"] input[value="video"]');
    await page.click('[aria-label="Render"] button.primary');
    await page.waitForFunction(() => /\d+% · \d+\/\d+ frames/.test(document.querySelector('[aria-label="Render"] .job')?.textContent ?? ""), null, { timeout: 90_000 });
    expect(await page.textContent("header button.render")).toMatch(/Rendering \d+%/);
    await page.click('[aria-label="Render"] .job button:has-text("Cancel")');
    await page.waitForFunction(() => /cancelled/.test(document.querySelector('[aria-label="Render"]')?.textContent ?? ""), null, { timeout: 30_000 });
    await new Promise((res) => setTimeout(res, 500));
    expect(readdirSync(join(dir, "output")).filter((f) => f.includes(".partial."))).toEqual([]);
    expect(await page.textContent("header button.render")).toBe("Render");
    await page.keyboard.press("Escape");
  }, 180_000);
});
