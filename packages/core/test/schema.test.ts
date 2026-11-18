import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AjvModule from "ajv";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const Ajv = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as new (o: object) => import("ajv").default;
const video = new Ajv({ allErrors: true }).compile(JSON.parse(readFileSync(root + "packages/core/schema/video.schema.json", "utf8")));

describe("video file format", () => {
  it("a modulation needs an amount, except one that removes the base's", () => {
    expect(video({ version: 2, modulations: [{ target: "ring.radius", source: "bass.env" }] })).toBe(false);
    expect(video({ version: 2, modulations: [{ target: "ring.radius", source: "bass.env", amount: 0.5 }] })).toBe(true);
    expect(video({ version: 2, modulations: [{ target: "ring.radius", source: "bass.env", remove: true }] })).toBe(true);
  });
});
