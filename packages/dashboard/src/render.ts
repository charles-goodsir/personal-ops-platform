import { maskDigits } from "@ops/finance";
import type { Dashboard } from "./data.js";
import { esc } from "./html.js";

const nzd = (n: number) =>
  `$${n.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: Date) => d.toISOString().slice(0, 10);
const age = (ms: number) => {
  const h = Math.round(ms / 3_600_000);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
};

// Charts are inline SVG with presentation attributes only, because the
// Content-Security-Policy allows no inline style. Colours come from classes in
// the stylesheet. Every mark has a <title>, which is the hover text, and every
// chart has its numbers in a table underneath.

function meter(percent: number) {
  const fill = percent >= 100 ? "crit" : percent >= 80 ? "warn" : "ok";
  const width = Math.min(100, Math.max(0, percent));
  return `<svg class="meter" width="100%" height="10" role="img" aria-label="${esc(percent)} percent used">
<rect class="track" width="100%" height="10" rx="5"/>
<rect class="fill-${fill}" width="${width}%" height="10" rx="5"/>
</svg>`;
}

function status(percent: number) {
  if (percent >= 100) return `<span class="crit">▲ Over</span>`;
  if (percent >= 80) return `<span class="warn">● Near limit</span>`;
  return `<span class="ok">✓ On track</span>`;
}

function fortnight(d: Dashboard) {
  const m = d.fortnight;
  if (m === null)
    return `<p class="muted">No spending target set. Send /payday set spending &lt;amount&gt; and /payday set payday &lt;date&gt; to the bot.</p>`;
  return `<div class="row">
<div class="row-head"><span>Since payday</span><span class="muted">${nzd(m.spent)} of ${nzd(m.target)} (${esc(m.percent)}%) ${status(m.percent)}</span></div>
${meter(m.percent)}
<p class="muted">${esc(m.daysLeft)} days to payday</p>
</div>`;
}

// Progress towards a goal: the same track as the meter, but filling up is good,
// so there is no warning colour.
function progress(percent: number) {
  const width = Math.min(100, Math.max(0, percent));
  return `<svg class="meter" width="100%" height="10" role="img" aria-label="${esc(percent)} percent saved">
<rect class="track" width="100%" height="10" rx="5"/>
<rect class="bar" width="${width}%" height="10" rx="5"/>
</svg>`;
}

function goals(d: Dashboard) {
  if (d.goals.length === 0)
    return `<p class="muted">No goals yet. Send /goal add &lt;name&gt; &lt;target&gt; to the bot.</p>`;
  return d.goals
    .map((g) => {
      const percent = Math.round((g.saved / g.target) * 100);
      return `<div class="row">
<div class="row-head"><span>${esc(g.name)}</span><span class="muted">${nzd(g.saved)} of ${nzd(g.target)} (${esc(percent)}%)${g.due ? `, due ${esc(g.due)}` : ""}${percent >= 100 ? ` <span class="ok">✓ Reached</span>` : ""}</span></div>
${progress(percent)}
</div>`;
    })
    .join("\n");
}

function categories(d: Dashboard) {
  const shown = d.month.byCategory.slice(0, 8);
  const rest = d.month.byCategory.slice(8);
  const rows = [
    ...shown,
    ...(rest.length
      ? [
          {
            category: "Other",
            spent: rest.reduce((s, c) => s + c.spent, 0),
            count: rest.reduce((s, c) => s + c.count, 0),
          },
        ]
      : []),
  ];
  if (rows.length === 0)
    return `<p class="muted">Nothing spent yet this month.</p>`;
  const max = Math.max(...rows.map((r) => r.spent));
  const bars = rows
    .map(
      (r) => `<div class="bar-row">
<span>${esc(r.category)}</span>
<svg width="100%" height="12" role="img" aria-label="${esc(r.category)} ${nzd(r.spent)}"><rect class="bar" width="${((r.spent / max) * 100).toFixed(1)}%" height="12" rx="4"><title>${esc(r.category)}: ${nzd(r.spent)} (${esc(r.count)} transactions)</title></rect></svg>
<span class="num">${nzd(r.spent)}</span>
</div>`,
    )
    .join("\n");
  return bars;
}

function trend(d: Dashboard) {
  const H = 150;
  const top = 18;
  const max = Math.max(1, ...d.trend.map((t) => t.total));
  const slot = 100 / d.trend.length;
  const cols = d.trend
    .map((t, i) => {
      const h = Math.max(1, (t.total / max) * (H - top));
      const cx = slot * i + slot / 2;
      // A nested svg puts the origin at the column's centre, so the column can
      // be a fixed 24px wide whatever the width of the chart.
      return `<svg x="${cx.toFixed(2)}%" y="0" overflow="visible">
<rect class="${t.current ? "bar" : "bar-muted"}" x="-12" y="${(H - h).toFixed(1)}" width="24" height="${h.toFixed(1)}" rx="3"><title>${esc(t.label)}: ${nzd(t.total)}${t.current ? " so far" : ""}</title></rect>
<text class="val" x="0" y="${(H - h - 5).toFixed(1)}" text-anchor="middle">${Math.round(t.total).toLocaleString("en-NZ")}</text>
<text class="axis" x="0" y="${H + 16}" text-anchor="middle">${esc(t.label)}</text>
</svg>`;
    })
    .join("\n");
  const table = d.trend
    .map(
      (t) =>
        `<tr><td>${esc(t.label)}${t.current ? " (so far)" : ""}</td><td class="num">${nzd(t.total)}</td></tr>`,
    )
    .join("");
  return `<svg width="100%" height="${H + 24}" role="img" aria-label="Spending per month, last ${d.trend.length} months">
<line class="base" x1="0" x2="100%" y1="${H}" y2="${H}"/>
${cols}
</svg>
<details><summary>Table</summary><table><tbody>${table}</tbody></table></details>`;
}

function subscriptions(d: Dashboard, hidePayees: boolean) {
  if (d.subscriptions.length === 0)
    return `<p class="muted">No recurring charges found.</p>`;
  const rows = d.subscriptions
    .map(
      (s, i) =>
        `<tr><td>${hidePayees ? `Subscription ${i + 1}` : esc(maskDigits(s.payee))}</td><td>${esc(s.cadence)}</td><td class="num">${nzd(s.typicalAmount)}</td><td class="num">${nzd(s.monthlyCost)}</td><td>${esc(day(s.nextExpected))}</td></tr>`,
    )
    .join("");
  const monthly = d.subscriptions.reduce((t, s) => t + s.monthlyCost, 0);
  return `<div class="scroll"><table><thead><tr><th>Payee</th><th>Cadence</th><th class="num">Typical</th><th class="num">Per month</th><th>Next</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="3">Total</td><td class="num">${nzd(monthly)}</td><td></td></tr></tfoot></table></div>`;
}

function jobs(d: Dashboard) {
  const rows = d.jobs
    .map(({ job, health: h }) => {
      const cell =
        h.state === "ok"
          ? `<span class="ok">✓ ok</span></td><td>${age(h.ageMs)} ago`
          : h.state === "never"
            ? `<span class="warn">● no run recorded</span></td><td>`
            : h.state === "late"
              ? `<span class="crit">▲ late</span></td><td>${age(h.ageMs)} ago`
              : `<span class="warn">● failing (${esc(h.failures)} in a row)</span></td><td>${age(h.ageMs)} ago`;
      return `<tr><td>${esc(job)}</td><td>${cell}</td></tr>`;
    })
    .join("");
  return `<div class="scroll"><table><thead><tr><th>Job</th><th>State</th><th>Last ok</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderDashboard(
  d: Dashboard,
  opts: { role: string; hidePayees: boolean },
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Personal Ops</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header>
<h1>Personal Ops</h1>
<p class="muted">${esc(d.month.range.label)}</p>
<p class="muted">${esc(d.freshness)}</p>
</header>
<section class="tiles">
<div class="tile hero"><span class="label">Spent this month</span><span class="value">${nzd(d.month.total)}</span></div>
<div class="tile"><span class="label">Income</span><span class="value">${nzd(d.month.income)}</span></div>
<div class="tile"><span class="label">Invested</span><span class="value">${nzd(d.month.invested)}</span></div>
</section>
<section><h2>Spending this fortnight</h2>
${fortnight(d)}
</section>
<section><h2>Goals</h2>
${goals(d)}
</section>
<section><h2>Spending by category</h2>
${categories(d)}
</section>
<section><h2>Last ${d.trend.length} months</h2>
${trend(d)}
</section>
<section><h2>Subscriptions</h2>
${subscriptions(d, opts.hidePayees)}
</section>
<section><h2>Jobs</h2>
${jobs(d)}
</section>
<footer class="muted">Read-only. Database role: ${esc(opts.role)}</footer>
</body>
</html>
`;
}
