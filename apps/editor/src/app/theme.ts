// Global styles: dark, dense, Ableton-like; Space Grotesk for the UI, JetBrains Mono for numbers; amber accent.
const css = `
:root {
  --bg0: #111111; --bg1: #181818; --bg2: #202020; --bg3: #2a2a2a; --line: #303030; --line2: #3c3c3c;
  --text: #d9d9d6; --dim: #8b8b86; --faint: #5c5c58;
  --accent: #f5a524; --accent-dim: #f5a52433; --danger: #e5484d;
  --ui: 'Space Grotesk', system-ui, sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg0); color: var(--text); font: 13px/1.3 var(--ui);
  -webkit-font-smoothing: antialiased; overflow: hidden; user-select: none; }
button, select, input, textarea { font: inherit; color: inherit; }
button { background: var(--bg3); border: 1px solid var(--line2); border-radius: 3px; padding: 3px 9px; cursor: pointer; }
button:hover { border-color: var(--dim); }
button.on { background: var(--accent); color: #111; border-color: var(--accent); }
button:disabled { opacity: .4; cursor: default; }
select { background: var(--bg3); border: 1px solid var(--line2); border-radius: 3px; padding: 2px 6px; }
input[type=text], input[type=number], textarea { background: var(--bg0); border: 1px solid var(--line2); border-radius: 3px; padding: 2px 5px; user-select: text; }
input:focus, textarea:focus, select:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
input[type=range] { -webkit-appearance: none; appearance: none; background: transparent; height: 14px; cursor: default; }
input[type=range]::-webkit-slider-runnable-track { height: 3px; background: var(--bg3); border-radius: 2px; }
input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 9px; height: 13px; margin-top: -5px; border-radius: 2px;
  background: var(--dim); border: none; }
input[type=range]:hover::-webkit-slider-thumb, input[type=range]:focus::-webkit-slider-thumb { background: var(--accent); }
input[type=range]:focus { outline: none; }
.mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
`;
const style = document.createElement("style");
style.textContent = css;
document.head.appendChild(style);
