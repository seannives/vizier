import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const vizier = (...args: string[]) => spawnSync("bash", [root + "bin/vizier", ...args], { cwd: root, encoding: "utf8" });

describe("the vizier command", () => {
  // the demo's audio isn't in git; generate it (on a fresh machine, e.g. CI) so validate finds every file
  beforeAll(() => { const r = vizier("demo"); expect(r.status).toBe(0); }, 60_000);

  it("lists its commands", () => {
    const r = vizier("help");
    expect(r.status).toBe(0);
    for (const c of ["render", "editor", "live", "validate", "analyze", "migrate", "demo"]) expect(r.stdout).toMatch(new RegExp(`\\n  ${c} `));
  });
  it("explains a command, with help or --help", () => {
    expect(vizier("help", "render").stdout).toMatch(/--still-bar/);
    expect(vizier("render", "--help").stdout).toMatch(/--still-bar/);
  });
  it("runs a command and passes on its exit code", () => {
    const ok = vizier("validate", "projects/demo");
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/✓ song.json/);
    expect(ok.stderr).not.toMatch(/ExperimentalWarning/);
    expect(vizier("validate", "projects/does-not-exist").status).not.toBe(0);
    expect(vizier("nope").status).toBe(1);
  });
});
