#!/usr/bin/env node
/**
 * The `vizier` command: one entry point for every tool, with its own help.
 *   vizier help              list the commands
 *   vizier help <command>    details for one command (same as `vizier <command> --help`)
 * Paths are relative to the folder you run it from.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

interface Command { script: string; args?: string[]; summary: string; usage: string; details: string }

const COMMANDS: Record<string, Command> = {
  render: {
    script: "apps/offline/src/cli.ts",
    summary: "render a video (or a still) of a project",
    usage: "vizier render <project> [--video <name>] [options]",
    details: `
Renders the video's own range and format to <project>/output/<video>-<format>.mp4, with a .json
snapshot of exactly what was rendered. A new render replaces the old one of the same name.

  --video <name>       the video in <project>/videos/ (needed if there's more than one)
  --gpu                render with the GPU (much faster on a Mac)
  --profile <id>       a different format: youtube, youtube60, youtube4k, shorts, reels, igfeed, draft
  --bars 81-97         only these bars (the end is exclusive)
  --start <s> --duration <s>   only this stretch, in seconds
  --still-bar <bar>    one frame as a PNG, at a bar position (e.g. 105 or 105.5)
  --still <frame>      one frame as a PNG, by frame number
  --keep               add a timestamp to the file name instead of replacing the last render
  --bitrate <Mbps>     video bitrate (default: 1.5 × the format's)
  --encoder ffmpeg     encode with ffmpeg's libx264 instead of in Chrome (slower)
  --bench <frames>     measure drawing speed only (live headroom); no file is written
  --out <file>         write somewhere else

Examples:
  vizier render projects/the-maleficus --video youtube-full --gpu
  vizier render projects/the-maleficus --video youtube-full --still-bar 85 --gpu
  vizier render projects/the-maleficus --video youtube-full --bars 81-97 --profile reels --gpu`,
  },
  editor: {
    script: "apps/editor/src/server.ts",
    summary: "open the editor for a project (in Chrome)",
    usage: "vizier editor <project> [--video <name>] [--port 5174] [--no-open]",
    details: `
Starts the editor and opens it in Chrome at http://localhost:5174. Stop it with Ctrl+C.
Unsaved changes live in the browser tab: if the editor stops, start it again and save.

  --video <name>   the video to open first
  --port <n>       a different port (default 5174)
  --no-open        don't open Chrome (e.g. when the tab is already open)

In the editor, press ? for keyboard shortcuts. See docs/editor.md.`,
  },
  live: {
    script: "apps/live/src/server.ts",
    summary: "play a project fullscreen with the visuals in time (live window)",
    usage: "vizier live <project> [--video <name>] [--profile live|live720] [--port 5173]",
    details: `
Serves the live window at http://localhost:5173: plays the mix and renders the visuals in time with it,
with a dropped-frame display. Keys in the window: space, ←/→, 1–9, f (fullscreen), [ ] (sync), h.`,
  },
  validate: {
    script: "apps/offline/src/tools.ts", args: ["validate"],
    summary: "check a project's files (format, references, audio files)",
    usage: "vizier validate <project>",
    details: `
Checks song.json and every video: the file format, that layers, tracks, parameters and colours exist,
and that the audio files are there. Old names that still work are listed as warnings (see migrate).`,
  },
  analyze: {
    script: "apps/offline/src/tools.ts", args: ["analyze"],
    summary: "suggest tempo, bar 1, where each stem plays and section changes",
    usage: "vizier analyze <project or folder of stems> [--bpm 155] [--mix <track>] [--json]",
    details: `
Listens to the stems and suggests a grid for song.json. Suggestions, not answers: check them.

  --bpm <n>       use this tempo instead of the detected one
  --mix <track>   which track is the full mix (default: one named mix/main/master, or the first)
  --json          machine-readable output`,
  },
  migrate: {
    script: "apps/offline/src/tools.ts", args: ["migrate"],
    summary: "update old names in a project's files",
    usage: "vizier migrate <project>",
    details: `
Rewrites names that changed (e.g. "profiles" → "format", palette "acid" → "accent") in place,
keeping the files' order and layout. Commit the result in your projects repo.`,
  },
  demo: {
    script: "scripts/make-demo-audio.ts",
    summary: "generate the demo project's audio",
    usage: "vizier demo",
    details: `
Writes projects/demo/media/{mix,drums,bass,pad}.wav: a 32-bar, 128 BPM sketch, the same every time.`,
  },
  "docs-images": {
    script: "scripts/make-docs-images.ts",
    summary: "render the pictures in docs/visuals.md",
    usage: "vizier docs-images",
    details: `
Renders each generator and effect from the demo song's audio into docs/images/visuals/*.jpg. Run it after
changing how a generator or effect looks. Needs Chrome and ffmpeg.`,
  },
};

const [cmd, ...rest] = process.argv.slice(2);
const version = () => JSON.parse(readFileSync(root + "package.json", "utf8")).version as string;

function overview() {
  const w = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  console.log(`vizier ${version()}: audio-reactive visuals for music videos and live shows

usage: vizier <command> [arguments]

${Object.entries(COMMANDS).map(([k, c]) => `  ${k.padEnd(w)}   ${c.summary}`).join("\n")}

  vizier help <command>   details and options for a command
  vizier version          the installed version

Projects are folders under projects/ (see docs/projects.md). Run from the vizier folder,
or anywhere with paths to your projects.`);
}
function details(name: string) {
  const c = COMMANDS[name];
  if (!c) { console.error(`vizier: no command "${name}". Try: vizier help`); process.exit(1); }
  console.log(`${c.usage}\n\n${c.summary[0]!.toUpperCase()}${c.summary.slice(1)}.\n${c.details}`);
}

if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
  if (rest[0]) details(rest[0]); else overview();
  process.exit(0);
}
if (cmd === "version" || cmd === "--version" || cmd === "-v") { console.log(version()); process.exit(0); }
const c = COMMANDS[cmd];
if (!c) { console.error(`vizier: no command "${cmd}". Try: vizier help`); process.exit(1); }
if (rest.includes("--help") || rest.includes("-h")) { details(cmd); process.exit(0); }

const child = spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", root + c.script, ...(c.args ?? []), ...rest], { stdio: "inherit" });
// Ctrl+C reaches the child directly (same terminal); just wait for it to finish.
process.on("SIGINT", () => {});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
