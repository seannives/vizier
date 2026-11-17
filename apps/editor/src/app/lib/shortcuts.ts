/**
 * Keyboard shortcuts, in one table so they're easy to change and to list (press ?).
 * "Mod" is ⌘ on a Mac, Ctrl elsewhere. Chrome keeps ⌘W, ⌘T, ⌘N and ⌘Q for itself, so they're never used.
 */
export interface Shortcut {
  keys: string;
  label: string;
  group: string;
  run: () => void;
  /** Other key combinations that do the same (not listed separately). */
  alt?: string[];
  /** How to show the keys in the list, when the default isn't clear (e.g. "Return or fn←"). */
  display?: string;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** "Shift+Mod+Z" → modifiers + key. The key itself may be "+" ("+", "Mod++"). */
function parse(spec: string): { mods: string[]; key: string } {
  if (spec === "+") return { mods: [], key: "+" };
  if (spec.endsWith("++")) return { mods: spec.slice(0, -2).split("+"), key: "+" };
  const parts = spec.split("+");
  const key = parts.pop()!;
  return { mods: parts, key };
}

/** Display form: "Shift+Mod+Z" → "⇧⌘Z". */
export function displayKeys(spec: string): string {
  const { mods, key } = parse(spec);
  const names: Record<string, string> = isMac
    ? { Mod: "⌘", Shift: "⇧", Alt: "⌥", ArrowLeft: "←", ArrowRight: "→", Enter: "Return", Backspace: "⌫", Escape: "Esc" }
    : { Mod: "Ctrl+", Shift: "Shift+", Alt: "Alt+", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc" };
  return [...mods, key].map((k) => names[k] ?? k).join("");
}

export function matches(spec: string, e: KeyboardEvent): boolean {
  const { mods: parts, key } = parse(spec);
  const want = { mod: parts.includes("Mod"), shift: parts.includes("Shift"), alt: parts.includes("Alt") };
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod !== want.mod || e.altKey !== want.alt) return false;
  const k = key === "Space" ? " " : key;
  // For symbols typed with Shift (?, +) don't require Shift to be declared. Space isn't one: ⇧Space is its own shortcut.
  if (k.length === 1 && k !== " " && !/[a-z0-9]/i.test(k)) return e.key === k;
  if (e.shiftKey !== want.shift) return false;
  return e.key.toLowerCase() === k.toLowerCase();
}

export function handleKey(table: Shortcut[], e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return false;
  for (const s of table) if ([s.keys, ...(s.alt ?? [])].some((k) => matches(k, e))) { e.preventDefault(); s.run(); return true; }
  return false;
}
