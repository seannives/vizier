<script lang="ts">
  import { displayKeys, type Shortcut } from "../lib/shortcuts.ts";
  let { shortcuts, onclose }: { shortcuts: Shortcut[]; onclose: () => void } = $props();
  const groups = $derived([...new Set(shortcuts.map((s) => s.group))]);
</script>

<div class="scrim" role="presentation" onclick={onclose}>
  <div class="panel" role="dialog" aria-label="Keyboard shortcuts">
    <h2>Keyboard shortcuts</h2>
    <div class="cols">
      {#each groups as g}
        <section>
          <h3>{g}</h3>
          {#each shortcuts.filter((s) => s.group === g) as s}
            <div class="row"><span class="keys mono">{s.display ?? displayKeys(s.keys)}</span><span>{s.label}</span></div>
          {/each}
        </section>
      {/each}
    </div>
    <p class="hint">Press ? or Esc to close</p>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; background: #000a; display: flex; align-items: center; justify-content: center; z-index: 10; }
  .panel { background: var(--bg2); border: 1px solid var(--line2); border-radius: 6px; padding: 18px 22px; min-width: 520px; }
  h2 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
  h3 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--dim); font-weight: 500; }
  .cols { display: grid; grid-template-columns: repeat(3, auto); gap: 18px 28px; }
  .row { display: flex; gap: 12px; padding: 2px 0; }
  .keys { min-width: 76px; color: var(--accent); }
  .hint { margin: 14px 0 0; color: var(--faint); font-size: 11px; }
</style>
