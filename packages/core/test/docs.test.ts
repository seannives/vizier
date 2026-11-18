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
  it("has a picture for every generator and effect", () => {
    const missing = [...Object.keys(GENERATORS), ...Object.keys(EFFECTS)].filter((id) => !existsSync(root + `docs/images/visuals/${id}.jpg`) || !doc.includes(`images/visuals/${id}.jpg`));
    expect(missing, "add to scripts/make-docs-images.ts, run vizier docs-images, and link the picture").toEqual([]);
  });
});
