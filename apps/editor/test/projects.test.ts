import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listProjects, projectIdFor, beginProject, addProjectMedia, finishProject, discardProject } from "../src/projects.ts";
import { DEMO, makeDemoTracks, wav } from "../../../scripts/demo-audio.ts";
import { validateProject, buildProject, resolveVideo, type SongFile, type VideoFile } from "../../../packages/core/src/index.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "vizier-projects-")); });

describe("projects", () => {
  it("lists folders with a song.json, by title", () => {
    for (const [id, title] of [["b", "Beta"], ["a", "Alpha"]]) { mkdirSync(join(root, id)); writeFileSync(join(root, id, "song.json"), JSON.stringify({ title })); }
    mkdirSync(join(root, "not-a-project"));
    expect(listProjects(root)).toEqual([{ id: "a", title: "Alpha" }, { id: "b", title: "Beta" }]);
  });
  it("names the folder after the title, never reusing one", () => {
    expect(projectIdFor(root, "The Maleficus!")).toBe("the-maleficus");
    mkdirSync(join(root, "the-maleficus"));
    expect(projectIdFor(root, "The Maleficus!")).toBe("the-maleficus-2");
    expect(projectIdFor(root, "Café Noir")).toBe("cafe-noir");
  });
  it("makes a project from a title and its audio: the mix, stems, a first guess at the grid, an empty YouTube video", () => {
    const t = makeDemoTracks();
    const id = beginProject(root, "Second Song");
    expect(listProjects(root)).toEqual([]);                           // not a project until finished
    const mix = addProjectMedia(root, id, "Second Song (main).wav", wav(t.mix, DEMO.sampleRate));
    const bass = addProjectMedia(root, id, "Bass.wav", wav(t.bass, DEMO.sampleRate));
    const pad = addProjectMedia(root, id, "pad.wav", wav(t.pad, DEMO.sampleRate));
    const { dir, song } = finishProject(root, id, mix, [bass, pad]);
    expect(dir).toBe(join(root, "second-song"));
    expect(song.title).toBe("Second Song");
    expect(song.tracks).toEqual([
      { id: "mix", name: "Mix", file: "media/Second Song (main).wav", mix: true },
      { id: "bass", name: "Bass", file: "media/Bass.wav" },
      { id: "pad", name: "pad", file: "media/pad.wav" },
    ]);
    expect(song.grid!.tempo[0]!.bpm).toBeCloseTo(DEMO.bpm, 0);          // the demo is 128 BPM, bar 1 at 0.75 s
    expect(song.grid!.downbeat).toBeCloseTo(DEMO.leadIn, 1);
    const video = JSON.parse(readFileSync(join(dir, "videos/youtube-full.json"), "utf8")) as VideoFile;
    expect(video).toMatchObject({ format: "youtube", layers: [] });
    const saved = JSON.parse(readFileSync(join(dir, "song.json"), "utf8")) as SongFile;
    expect(validateProject(buildProject(saved, resolveVideo("youtube-full", () => video), (x) => x.file))).toEqual([]);
    expect(listProjects(root)).toEqual([{ id: "second-song", title: "Second Song" }]);
  });
  it("an unfinished project can be thrown away; a finished one can't", () => {
    const id = beginProject(root, "Oops");
    discardProject(root, id);
    expect(existsSync(join(root, id))).toBe(false);
    expect(() => addProjectMedia(root, id, "x.wav", new Uint8Array([1]))).toThrow();
    expect(() => beginProject(root, "  ")).toThrow(/title/);
    expect(() => addProjectMedia(root, "../etc", "x.wav", new Uint8Array([1]))).toThrow(/bad project id/);
  });
});
