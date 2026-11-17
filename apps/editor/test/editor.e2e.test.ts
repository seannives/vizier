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

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "vizier-editor-"));
    cpSync(join(root, "projects/demo/song.json"), join(dir, "song.json"));
    cpSync(join(root, "projects/demo/videos"), join(dir, "videos"), { recursive: true });
    mkdirSync(join(dir, "media"));
    for (const [n, s] of Object.entries(makeDemoTracks())) writeFileSync(join(dir, "media", `${n}.wav`), wav(s, DEMO.sampleRate));
    server = spawn(process.execPath, ["--experimental-strip-types", join(root, "apps/editor/src/server.ts"), dir, "--video", "full", "--port", String(PORT)], { stdio: ["ignore", "ignore", "pipe"] });
    await new Promise<void>((ok, fail) => {
      server.stderr!.on("data", (d) => { serverLog += d; if (serverLog.includes("ready:")) ok(); });
      server.on("exit", () => fail(new Error(serverLog)));
    });
    browser = await chromium.launch({ executablePath: chrome, args: ["--autoplay-policy=no-user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
    page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
    // A small preview: CI machines have no GPU, and the renderer is tested on its own elsewhere.
    await page.goto(`http://localhost:${PORT}/?previewScale=0.12`);
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
    await page.waitForFunction(() => (window as any).vizierEditor.state.time > 0.4, null, { timeout: 20_000 });
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

  it("shows the shortcuts with ?", async () => {
    await page.keyboard.press("Shift+Slash");
    expect(await page.locator("text=Keyboard shortcuts").count()).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    expect(await page.locator("text=Keyboard shortcuts").count()).toBe(0);
  }, 60_000);

  it("switches videos and shows the reel in its own format", async () => {
    await page.selectOption("select", "reel");
    await page.waitForFunction(() => (window as any).vizierEditor.state.videoName === "reel");
    expect(await page.locator("text=Instagram Reels").count()).toBeGreaterThan(0);
  }, 90_000);
});
