// Colours are the validated reference palette: one accent hue, a gray for
// everything that should recede, and the status colours for budgets and jobs.
// Status always comes with a word and a symbol, never colour alone.
export const CSS = `
:root {
  color-scheme: light dark;
  --surface: #fcfcfb; --page: #f9f9f7; --ink: #0b0b0b; --ink2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --base: #c3c2b7; --accent: #2a78d6; --bar-muted: #b5b4aa; --track: #cde2fb;
  --ok: #006300; --warn: #8a5a00; --crit: #b02a2a;
  --fill-ok: #2a78d6; --fill-warn: #fab219; --fill-crit: #d03b3b;
}
@media (prefers-color-scheme: dark) {
  :root {
    --surface: #1a1a19; --page: #0d0d0d; --ink: #ffffff; --ink2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --base: #383835; --accent: #3987e5; --bar-muted: #4a4a46; --track: #0d366b;
    --ok: #0ca30c; --warn: #fab219; --crit: #ec6a6a;
    --fill-ok: #3987e5;
  }
}
* { box-sizing: border-box; }
body { background: var(--page); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0 auto; max-width: 52rem; padding: 1rem; }
h1 { font-size: 1.5rem; margin: 0; }
h2 { font-size: 1rem; margin: 0 0 .75rem; color: var(--ink2); font-weight: 600; }
section { background: var(--surface); border: 1px solid var(--grid); border-radius: 12px; padding: 1rem; margin: 1rem 0; }
header p { margin: 0; }
.muted { color: var(--muted); }
.ok { color: var(--ok); } .warn { color: var(--warn); } .crit { color: var(--crit); }
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; background: none; border: 0; padding: 0; }
.tile { background: var(--surface); border: 1px solid var(--grid); border-radius: 12px; padding: 1rem; display: flex; flex-direction: column; }
.tile .label { color: var(--ink2); font-size: .875rem; }
.tile .value { font-size: 1.5rem; font-weight: 600; }
.tile.hero { grid-column: 1 / -1; }
.tile.hero .value { font-size: 3rem; line-height: 1.1; }
.row { margin: .75rem 0; }
.row-head { display: flex; justify-content: space-between; gap: .5rem; flex-wrap: wrap; margin-bottom: .25rem; }
.track { fill: var(--track); }
.fill-ok { fill: var(--fill-ok); } .fill-warn { fill: var(--fill-warn); } .fill-crit { fill: var(--fill-crit); }
.bar-row { display: grid; grid-template-columns: 9rem 1fr 6rem; gap: .5rem; align-items: center; margin: .35rem 0; }
.bar { fill: var(--accent); } .bar-muted { fill: var(--bar-muted); }
.bar:hover, .bar-muted:hover { opacity: .8; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
svg text { font: 12px system-ui, sans-serif; }
.val { fill: var(--ink2); } .axis { fill: var(--muted); }
.base { stroke: var(--base); stroke-width: 1; }
.scroll { overflow-x: auto; }
.scroll table { min-width: 30rem; }
table { width: 100%; border-collapse: collapse; font-size: .9rem; }
th, td { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid var(--grid); }
th { color: var(--ink2); font-weight: 600; }
th.num, td.num { text-align: right; }
tfoot td { font-weight: 600; border-bottom: 0; }
details { margin-top: .5rem; color: var(--ink2); font-size: .875rem; }
footer { text-align: center; font-size: .8rem; margin: 1rem 0; }
@media (max-width: 30rem) { .bar-row { grid-template-columns: 6.5rem 1fr 5rem; } }
`;
