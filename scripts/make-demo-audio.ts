#!/usr/bin/env node
// pnpm demo: writes projects/demo/media/{mix,drums,bass,pad}.wav
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEMO, makeDemoTracks, wav } from "./demo-audio.ts";

const dir = fileURLToPath(new URL("../projects/demo/media/", import.meta.url));
mkdirSync(dir, { recursive: true });
for (const [name, samples] of Object.entries(makeDemoTracks())) writeFileSync(`${dir}${name}.wav`, wav(samples, DEMO.sampleRate));
console.log(`wrote demo audio to projects/demo/media/ (mix, drums, bass, pad: ${DEMO.bars} bars at ${DEMO.bpm} BPM)`);
