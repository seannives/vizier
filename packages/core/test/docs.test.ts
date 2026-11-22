import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GENERATORS, EFFECTS, LAYER_PARAMS, POST_PARAMS } from "../src/index.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const doc = readFileSync(root + "docs/visuals.md", "utf8");

describe("docs/visuals.md keeps up with the plugins", () => {
  it("explains every generator, effect and parameter", () => {
    const missing: string[] = [];
    for (const g of Object.values(GENERATORS)) {
      if (!doc.includes(`(\`${g.id}\`)`)) missing.push(`generator ${g.id}`);
      for (const p of g.params) if (!doc.includes(`(\`${p.name}\`)`)) missing.push(`${g.id}.${p.name}`);
      for (const c of g.colors ?? []) if (!doc.includes(`(\`${c.name}\``)) missing.push(`${g.id} colour ${c.name}`);
    }
    for (const e of Object.values(EFFECTS)) {
      if (!doc.includes(`(\`${e.id}\`)`)) missing.push(`effect ${e.id}`);
      for (const p of e.params) if (!doc.includes(`(\`${p.name}\`)`)) missing.push(`${e.id}.${p.name}`);
    }
    for (const p of [...LAYER_PARAMS, ...POST_PARAMS]) if (!doc.includes(`\`${p.name}\``)) missing.push(`layer/post ${p.name}`);
    expect(missing, "add these to docs/visuals.md").toEqual([]);
  });
  it("every parameter has a short description (its tooltip in the editor), the same as its row in the docs", () => {
    const rows = doc.split("\n").filter((l) => l.startsWith("| "));
    const problems: string[] = [];
    const all = [
      ...Object.values(GENERATORS).flatMap((g) => g.params.map((p) => [g.id, p] as const)),
      ...Object.values(EFFECTS).flatMap((e) => e.params.map((p) => [e.id, p] as const)),
      ...LAYER_PARAMS.map((p) => ["layer", p] as const), ...POST_PARAMS.map((p) => ["post", p] as const),
    ];
    for (const [owner, p] of all) {
      if (!p.description) { problems.push(`${owner}.${p.name}: no description`); continue; }
      if (p.description.length > 170) problems.push(`${owner}.${p.name}: description over 170 characters (a tooltip)`);
      if (!rows.some((r) => r.split("|")[1]!.includes(`\`${p.name}\``) && r.includes(`| ${p.description} |`)))
        problems.push(`${owner}.${p.name}: the docs row doesn't say "${p.description}"`);
    }
    expect(problems, "keep each parameter's description and its row in docs/visuals.md the same").toEqual([]);
  });
  it("has a picture for every generator and effect", () => {
    const missing = [...Object.keys(GENERATORS), ...Object.keys(EFFECTS)].filter((id) => !existsSync(root + `docs/images/visuals/${id}.jpg`) || !doc.includes(`images/visuals/${id}.jpg`));
    expect(missing, "add to scripts/make-docs-images.ts, run vizier docs-images, and link the picture").toEqual([]);
  });
});
