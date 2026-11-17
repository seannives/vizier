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

/** Display form: "Shift+Mod+Z" → "⇧⌘Z". */
export function displayKeys(spec: string): string {
  if (!isMac) return spec.replace("Mod", "Ctrl");
  return spec.split("+").map((k) => ({ Mod: "⌘", Shift: "⇧", Alt: "⌥", ArrowLeft: "←", ArrowRight: "→", Space: "Space", Enter: "Return", Backspace: "⌫", Escape: "Esc" } as Record<string, string>)[k] ?? k).join("");
}

export function matches(spec: string, e: KeyboardEvent): boolean {
  const parts = spec.split("+");
  const key = parts.pop()!;
  const want = { mod: parts.includes("Mod"), shift: parts.includes("Shift"), alt: parts.includes("Alt") };
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod !== want.mod || e.altKey !== want.alt) return false;
  const k = key === "Space" ? " " : key;
  // For symbols typed with Shift (?, +) don't require Shift to be declared.
  if (k.length === 1 && !/[a-z0-9]/i.test(k)) return e.key === k;
  if (e.shiftKey !== want.shift) return false;
  return e.key.toLowerCase() === k.toLowerCase();
}

export function handleKey(table: Shortcut[], e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return false;
  for (const s of table) if ([s.keys, ...(s.alt ?? [])].some((k) => matches(k, e))) { e.preventDefault(); s.run(); return true; }
  return false;
}
