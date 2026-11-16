// The live window. Visuals follow the audio clock, so they stay in sync at any display refresh rate.
import { Renderer } from "../../../packages/core/src/browser/renderer.ts";
import { sectionTimes, barToSeconds, secondsToBar, barLabel, type Project } from "../../../packages/core/src/index.ts";
import type { FeatureTrack } from "../../../packages/features/src/index.ts";
import { FrameStats } from "./stats.ts";

const $ = (id: string) => document.getElementById(id)!;

async function main() {
  const { profileId, project } = (await (await fetch("/config.json")).json()) as { profileId: string; project: Project };
  const tracks = (await (await fetch("/features.json")).json()) as Record<string, FeatureTrack>;
  await document.fonts.load("40px 'Special Elite'");
  const r = new Renderer(project, profileId, tracks);
  document.body.prepend(r.canvas);
  const sections = sectionTimes(project);
  const grid = project.grid;
  /** Jump by whole bars from time t (falls back to 2 s steps without a tempo). */
  const barStep = (t: number, n: number) => grid ? barToSeconds(Math.floor(secondsToBar(t, grid) + 1e-6) + n, grid) : t + 2 * n;
  const duration = Math.min(...Object.values(tracks).map((t) => t.frameCount / t.fps));

  // ---- audio ----
  const start = $("start");
  start.textContent = "loading audio…";
  const ctx = new AudioContext({ latencyHint: "interactive" });
  const buffer = await ctx.decodeAudioData(await (await fetch("/audio/main")).arrayBuffer());
  start.textContent = "click to start · h for help";
  let source: AudioBufferSourceNode | null = null;
  let playing = false, offset = 0, startedAt = 0, avOffsetMs = 0;
  const outLatency = () => (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  /** Song position of the sound coming out of the speakers right now. */
  const songTime = () => (playing ? offset + (ctx.currentTime - startedAt) - outLatency() : offset) + avOffsetMs / 1000;
  const play = async () => {
    await ctx.resume();
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    startedAt = ctx.currentTime;
    source.start(0, Math.max(0, offset));
    playing = true;
  };
  const pause = () => { if (!playing) return; offset = songTime() - avOffsetMs / 1000; source?.stop(); playing = false; };
  const seek = (t: number) => { const was = playing; pause(); offset = Math.min(Math.max(0, t), duration - 0.1); if (was) void play(); stats.reset(); };

  // ---- controls ----
  let helpShown = true, hudShown = true;
  start.addEventListener("click", () => { start.remove(); void play(); });
  addEventListener("keydown", (e) => {
    const t = songTime();
    if (e.key === " ") { e.preventDefault(); playing ? pause() : void play(); }
    else if (e.key === "ArrowRight") seek(barStep(t, e.shiftKey ? 8 : 1));
    else if (e.key === "ArrowLeft") seek(barStep(t, e.shiftKey ? -8 : -1));
    else if (e.key === "Home") seek(0);
    else if (e.key === "f") document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen();
    else if (e.key === "h") { if (helpShown) { helpShown = false; } else { hudShown = !hudShown; } }
    else if (e.key === "[") avOffsetMs -= 10;
    else if (e.key === "]") avOffsetMs += 10;
    else if (e.key === "r") stats.reset();
    else if (/^[1-9]$/.test(e.key) && sections[+e.key - 1]) seek(sections[+e.key - 1]!.t);
  });

  // ---- render loop ----
  const stats = new FrameStats();
  const hud = $("hud");
  let hudAt = 0;
  const loop = (now: number) => {
    const t = Math.max(0, songTime());
    const a = performance.now();
    r.renderAtTime(t);
    stats.frame(now, performance.now() - a);
    if (now - hudAt > 250) {
      hudAt = now;
      const s = stats.summary();
      const sec = [...sections].reverse().find((x) => x.t <= t + 1e-6);
      const bar = grid ? barLabel(secondsToBar(t, grid), grid) : "–";
      hud.style.display = hudShown ? "block" : "none";
      hud.textContent = [
        `${project.title} · ${r.profile.label}`,
        `${playing ? "▶" : "❚❚"} ${fmt(t)} / ${fmt(duration)} · bar ${bar} · ${sec?.name ?? ""}`,
        `display ${s.refreshHz.toFixed(0)} Hz · ${s.fps.toFixed(1)} fps`,
        `dropped ${s.dropped} total · ${s.droppedRecent} in last 10 s`,
        `draw ${s.drawAvg.toFixed(2)} ms avg · ${s.drawP99.toFixed(2)} ms p99 (CPU side)`,
        `audio latency ${(outLatency() * 1000).toFixed(0)} ms · A/V offset ${avOffsetMs} ms`,
        ...(helpShown ? ["", "space play/pause · ←/→ 1 bar (shift: 8) · 1–9 sections", "f fullscreen · [ ] A/V offset · r reset stats · h hide"] : []),
      ].join("\n");
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  (window as any).vizierLive = { stats: () => ({ ...stats.summary(), t: songTime(), playing }), play, seek };
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

main().catch((e) => { document.body.textContent = String(e?.stack ?? e); console.error(e); });
