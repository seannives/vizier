/**
 * Rendering from the editor: a queue of `vizier render` runs (one at a time), their progress, cancelling, and
 * the renders already in a project's output/ folder (with what each was made from, from the .json beside it).
 *
 * The editor runs the same command as the terminal, so a render from either is the same video.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync, readFileSync, statSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface RenderJob {
  id: number;
  dir: string;
  video: string;
  /** The whole song, whatever the video's range. */
  whole: boolean;
  /** Other options for the command (a render made again: its --profile, --bars…). */
  args?: string[];
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  done: number; total: number;
  startedAt?: number; endedAt?: number;
  /** The file written (project-relative), once done. */
  file?: string;
  /** Why it failed (the command's last lines). */
  error?: string;
}

export interface RenderFile {
  file: string; bytes: number; modified: number;
  /** The command's options it was made with (not the project or --video): to make it again the same way. */
  options?: string[];
  video?: string; profile?: string; seconds?: number; frames?: number; renderedAt?: string;
  commit?: string; localChanges?: boolean;
}

export class RenderQueue {
  jobs: RenderJob[] = [];
  private child: ChildProcess | null = null;
  private nextId = 1;
  private cli: string; private gpu: boolean; private log: (s: string) => void;
  constructor(cli: string, gpu: boolean, log: (s: string) => void = () => {}) { this.cli = cli; this.gpu = gpu; this.log = log; }

  add(dir: string, videos: string[], whole: boolean, args: string[] = []): RenderJob[] {
    const added = videos.map((video) => ({ id: this.nextId++, dir, video, whole, ...(args.length ? { args } : {}), status: "queued" as const, done: 0, total: 0 }));
    this.jobs.push(...added);
    // keep the list short: finished jobs beyond the last 20 go
    const finished = this.jobs.filter((j) => j.status !== "queued" && j.status !== "running");
    if (finished.length > 20) this.jobs = this.jobs.filter((j) => !finished.slice(0, finished.length - 20).includes(j));
    this.next();
    return added;
  }

  cancel(id: number) {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) return;
    if (j.status === "queued") { j.status = "cancelled"; j.endedAt = Date.now(); return; }
    if (j.status !== "running" || !this.child) return;
    j.status = "cancelled";
    // the whole process group: the command and the Chrome it started
    try { process.kill(-this.child.pid!, "SIGTERM"); } catch { this.child.kill("SIGTERM"); }
  }

  /** Whether a job is queued or running for a project. */
  busy(dir: string) { return this.jobs.some((j) => j.dir === dir && (j.status === "queued" || j.status === "running")); }

  private next() {
    if (this.child) return;
    const j = this.jobs.find((x) => x.status === "queued");
    if (!j) return;
    j.status = "running"; j.startedAt = Date.now();
    const args = ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", this.cli, j.dir, "--video", j.video, "--progress", ...(j.whole ? ["--whole"] : []), ...(j.args ?? []), ...(this.gpu ? ["--gpu"] : [])];
    this.log(`rendering ${j.video}${j.whole ? " (whole song)" : ""}`);
    const child = spawn(process.execPath, args, { stdio: ["ignore", "ignore", "pipe"], detached: true });
    this.child = child;
    const tail: string[] = [];
    let buf = "";
    child.stderr!.on("data", (d: Buffer) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        const m = /^PROGRESS (\d+) (\d+)$/.exec(line);
        if (m) { j.done = Number(m[1]); j.total = Number(m[2]); continue; }
        const w = /^\[vizier\] wrote (.+\.mp4) /.exec(line);
        if (w) j.file = w[1]!.replace(/^.*?(output\/)/, "output/");
        tail.push(line); if (tail.length > 12) tail.shift();
      }
    });
    child.on("exit", (code) => {
      this.child = null;
      j.endedAt = Date.now();
      if (j.status === "cancelled") {
        // a stopped render leaves only its temporary file: remove it
        const out = join(j.dir, "output");
        for (const f of existsSync(out) ? readdirSync(out) : []) if (f.endsWith(".partial.mp4")) rmSync(join(out, f), { force: true });
        this.log(`render of ${j.video} cancelled`);
      } else if (code === 0) { j.status = "done"; this.log(`rendered ${j.file ?? j.video}`); }
      else { j.status = "failed"; j.error = tail.filter((l) => !l.startsWith("PROGRESS")).slice(-6).join("\n") || `exit code ${code}`; this.log(`render of ${j.video} failed`); }
      this.next();
    });
  }
}

/** The renders in a project's output/ folder, newest first, with what the .json beside each says. */
export function listRenders(dir: string): RenderFile[] {
  const out = join(dir, "output");
  if (!existsSync(out)) return [];
  return readdirSync(out).filter((f) => f.endsWith(".mp4") && !f.endsWith(".partial.mp4")).map((f) => {
    const st = statSync(join(out, f));
    const r: RenderFile = { file: `output/${f}`, bytes: st.size, modified: st.mtimeMs };
    try {
      const m = JSON.parse(readFileSync(join(out, f.replace(/\.mp4$/, ".json")), "utf8"));
      Object.assign(r, { options: againOptions(m.command), video: m.video, profile: m.profile, seconds: m.range ? m.range.toSeconds - m.range.fromSeconds : undefined, frames: m.range?.frames, renderedAt: m.renderedAt, commit: m.vizier?.commit, localChanges: m.vizier?.localChanges });
    } catch { /* no snapshot: just the file */ }
    return r;
  }).sort((a, b) => b.modified - a.modified);
}

/** From the command a render was made with, the options to make it again: not the project, --video (given
 *  separately), --gpu or --progress (the editor adds those), or --out and --keep (it's replaced in place). */
export function againOptions(command: unknown): string[] {
  if (!Array.isArray(command)) return [];
  const out: string[] = [];
  const takesValue = new Set(["--video", "--profile", "--bars", "--start", "--duration", "--encoder", "--bitrate", "--out", "--still", "--still-bar", "--bench"]);
  for (let i = 0; i < command.length; i++) {
    const a = String(command[i]);
    if (!a.startsWith("--")) continue;                         // the project folder
    const v = takesValue.has(a) ? String(command[++i]) : undefined;
    if (["--video", "--gpu", "--progress", "--out", "--keep"].includes(a)) continue;
    out.push(a, ...(v !== undefined ? [v] : []));
  }
  return out;
}
