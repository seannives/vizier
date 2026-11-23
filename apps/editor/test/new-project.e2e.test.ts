// The editor started without a project: the start page makes a new one (title, dropped audio), and the project
// name in the top bar switches between projects. Uses a projects folder of its own, never the repo's.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";
import { DEMO, makeDemoTracks, wav } from "../../../scripts/demo-audio.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const chrome = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find((p) => p && existsSync(p));
const run = chrome && !process.env.VIZIER_QUICK ? describe : describe.skip;
const PORT = 5250 + Math.floor(Math.random() * 40);

run("new project (headless Chrome)", () => {
  let projects: string, server: ChildProcess, browser: Browser, page: Page;
  const errors: string[] = [];
  beforeAll(async () => {
    projects = mkdtempSync(join(tmpdir(), "vizier-projects-"));
    server = spawn(process.execPath, ["--experimental-strip-types", join(root, "apps/editor/src/server.ts"), "--projects", projects, "--port", String(PORT), "--no-open"], { stdio: ["ignore", "ignore", "pipe"] });
    let log = "";
    await new Promise<void>((ok, fail) => { server.stderr!.on("data", (d) => { log += d; if (log.includes("ready:")) ok(); }); server.on("exit", () => fail(new Error(log))); });
    browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
    page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
    page.on("pageerror", (e) => errors.push(e.message));
  }, 120_000);
  afterAll(async () => { await browser?.close(); server?.kill(); if (projects) rmSync(projects, { recursive: true, force: true }); });

  const dropFiles = (selector: string, files: [string, Buffer][]) => page.evaluate(async ({ selector, files }) => {
    const dt = new DataTransfer();
    for (const [name, b64] of files) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); dt.items.add(new File([u], name, { type: "audio/wav" })); }
    const el = document.querySelector(selector)!;
    el.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
    el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { selector, files: files.map(([n, b]) => [n, b.toString("base64")] as [string, string]) });
  const make = async (title: string) => {
    const t = makeDemoTracks();
    await page.fill('input[aria-label="Project title"]', title);
    // the stems first: the mix is found by its name, not its place
    await dropFiles(".drop", [["drums.wav", wav(t.drums, DEMO.sampleRate)], ["My Song MIX.wav", wav(t.mix, DEMO.sampleRate)]]);
    expect(await page.isChecked('.files li:nth-child(2) input[type="radio"]')).toBe(true);
    await Promise.all([page.waitForEvent("load", { timeout: 90_000 }), page.click("button.primary")]);
    await page.waitForFunction(() => (window as any).vizierEditor?.state?.status === "ready", null, { timeout: 90_000 });
  };

  it("opens on the start page and makes a project: folder, audio, song with a tempo guess, an empty YouTube video", async () => {
    await page.goto(`http://localhost:${PORT}/?previewScale=0`);
    await page.waitForSelector('[aria-label="Projects"]');
    await make("First Song");
    const dir = join(projects, "first-song");
    const song = JSON.parse(readFileSync(join(dir, "song.json"), "utf8"));
    expect(song.title).toBe("First Song");
    expect(song.tracks).toEqual([
      { id: "mix", name: "Mix", file: "media/My Song MIX.wav", mix: true },
      { id: "drums", name: "drums", file: "media/drums.wav" },
    ]);
    expect(song.grid.tempo[0].bpm).toBeCloseTo(DEMO.bpm, 0);
    expect(JSON.parse(readFileSync(join(dir, "videos/youtube-full.json"), "utf8"))).toMatchObject({ format: "youtube", layers: [] });
    expect(await page.title()).toBe("vizier · First Song");
    expect(await page.evaluate(() => (window as any).vizierEditor.state.videoName)).toBe("youtube-full");
    expect(errors).toEqual([]);
  }, 120_000);

  it("the project name opens the projects: make a second, then switch back to the first", async () => {
    await page.click("header button.proj");
    await make("Second Song");
    expect(await page.title()).toBe("vizier · Second Song");
    await page.click("header button.proj");
    await Promise.all([page.waitForEvent("load"), page.click('.projects li:has-text("First Song") button')]);
    await page.waitForFunction(() => document.title === "vizier · First Song", null, { timeout: 60_000 });
  }, 120_000);

  it("with unsaved changes, it won't switch until they're saved", async () => {
    await page.waitForFunction(() => (window as any).vizierEditor?.state?.status === "ready", null, { timeout: 60_000 });
    await page.selectOption('select[aria-label="Add a layer"]', "pulseGrid");
    await page.click("header button.proj");
    expect(await page.textContent('[aria-label="Projects"] .warn')).toMatch(/or undo your changes first/);
    expect(await page.isDisabled('.projects li:has-text("Second Song") button')).toBe(true);
    await page.keyboard.press("Escape");
  }, 60_000);

  it("a new project has the Palette & picture row: the palette, film grain and vignette, with A for lanes", async () => {
    await page.waitForFunction(() => (window as any).vizierEditor?.state?.status === "ready", null, { timeout: 60_000 });
    if ((await page.evaluate(() => (window as any).vizierEditor.state.dirtyFiles.length))) await page.keyboard.press("ControlOrMeta+s");
    const y = await page.evaluate(() => (window as any).vizierEditor.timeline().layerY("_video"));
    const x = await page.evaluate(() => (window as any).vizierEditor.timeline().pageX(5));
    await page.mouse.click(x, y);
    await page.waitForSelector(".picture");
    expect(await page.locator(".picture [data-slot]").count()).toBe(5);
    const vig = page.locator('.picture input[type="text"][aria-label="Vignette"]');
    await vig.fill("0.2"); await vig.press("Enter");
    const video = () => page.evaluate(() => { const ed = (window as any).vizierEditor; return ed.session().doc.videos[ed.state.videoName]; });
    expect((await video()).post).toEqual({ vignette: 0.2 });
    await page.click('.picture button[aria-label="Automate Film grain"]');
    expect((await video()).automation.map((a: any) => a.target)).toContain("post.grain");
    expect(await page.locator('[data-lane="post.grain"]').count()).toBe(1);
  }, 60_000);
});
