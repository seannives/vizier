import { chromium } from "playwright-core";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FeatureTrack } from "../../../packages/features/src/index.ts";
import type { Project } from "../../../packages/core/src/index.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));

/** Bundle the renderer for the browser (esbuild resolves @vizier/* through tsconfig paths). */
async function bundle(): Promise<string> {
  const r = await build({ entryPoints: [root + "packages/core/src/browser/entry.ts"], bundle: true, write: false, format: "iife", target: "es2022", tsconfig: root + "tsconfig.json", logLevel: "error" });
  return r.outputFiles[0]!.text;
}

export interface RendererHandle { frame(n: number): Promise<Buffer>; close(): Promise<void> }

/**
 * Headless Chrome running the same renderer the live app uses.
 * Default: software GL (SwiftShader), which works anywhere, including CI. --gpu uses the machine's GPU (on a Mac: Metal via ANGLE).
 */
export async function openRenderer(project: Project, profileId: string, tracks: Record<string, FeatureTrack>, opts: { gpu: boolean }): Promise<RendererHandle> {
  const executablePath = process.env.CHROME_PATH;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : { channel: "chrome" }),
    args: opts.gpu ? ["--enable-gpu", "--ignore-gpu-blocklist"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => process.stderr.write(`[page] ${e.message}\n`));
  const font = readFileSync(root + "assets/fonts/SpecialElite-Regular.ttf").toString("base64");
  await page.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: 'Special Elite'; src: url(data:font/ttf;base64,${font}) format('truetype'); }
    body { margin: 0; background: #000; }</style></head><body></body></html>`);
  await page.addScriptTag({ content: await bundle() });
  await page.evaluate(([p, id, t]) => (window as any).vizier.init(p, id, t), [project, profileId, tracks] as const);
  return {
    async frame(n) {
      const b64 = await page.evaluate((f) => (window as any).vizier.renderAndRead(f), n);
      return Buffer.from(b64, "base64");
    },
    close: () => browser.close(),
  };
}
