/**
 * The editor window and the output window (the preview popped out) talk over a BroadcastChannel: both are pages
 * of the same editor server in the same browser. The editor sends what to show and where the playhead is; the
 * output window sends back clicks and drags on its layout handles, and keys pressed while it has focus.
 */
import type { Project, Transform } from "../../../../../packages/core/src/index.ts";

export type ToOutput =
  | { type: "show"; project: Project | null; profileId: string; selected: string | null }
  | { type: "time"; time: number; loopWraps: number }
  | { type: "close" };
export type ToEditor =
  | { type: "here" }                                    // the output window is open (sent every second)
  | { type: "bye" }                                     // it's closing
  | { type: "select"; id: string | null }
  | { type: "layout"; id: string; t: Transform; final: boolean }
  | { type: "key"; key: string; code: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean };
export type Msg = ToOutput | ToEditor | { type: "hello" }; // hello: the editor (re)started and asks who's there

export function openLink(onmessage: (m: Msg) => void): { send: (m: Msg) => void; close: () => void } {
  const ch = new BroadcastChannel(`vizier:${location.host}`);
  ch.onmessage = (e) => onmessage(e.data as Msg);
  return { send: (m) => ch.postMessage(m), close: () => ch.close() };
}
