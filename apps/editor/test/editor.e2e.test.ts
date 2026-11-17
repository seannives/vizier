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

  it("shows the shortcuts with ?", async () => {
    await page.keyboard.press("Shift+Slash");
    expect(await page.locator("text=Keyboard shortcuts").count()).toBeGreaterThan(0);
    expect(await page.locator("text=Close the shortcuts window").count()).toBe(1);
    expect(await page.locator(".row", { hasText: "Zoom in" }).count()).toBe(1);
    expect((await page.locator(".row", { hasText: "Zoom in" }).locator(".keys").textContent())?.trim()).toBe("+");
    await page.keyboard.press("Escape");
    expect(await page.locator("text=Keyboard shortcuts").count()).toBe(0);
  }, 60_000);

  it("switches videos and shows the reel in its own format", async () => {
    await page.selectOption("select", "reel");
    await page.waitForFunction(() => (window as any).vizierEditor.state.videoName === "reel");
    expect(await page.locator("text=Instagram Reels").count()).toBeGreaterThan(0);
  }, 90_000);
});
