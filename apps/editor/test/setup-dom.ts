// What jsdom lacks for the editor's components: a 2D canvas that accepts drawing calls (and ignores them), and
// ResizeObserver. Drawing itself is checked in Chrome by the end-to-end tests.
export function stubDom() {
  const ctx = new Proxy({}, { get: (_t, k) => (k === "measureText" ? () => ({ width: 10 }) : () => {}), set: () => true });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as any;
  HTMLCanvasElement.prototype.setPointerCapture = () => {};
  HTMLCanvasElement.prototype.releasePointerCapture = () => {};
  (globalThis as any).ResizeObserver ??= class { observe() {} disconnect() {} };
}
