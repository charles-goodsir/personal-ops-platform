import type { Db } from "@ops/core";
import { esc } from "./html.js";

export const CSS = `
:root { color-scheme: light dark; --bg: #fff; --fg: #1a1a1a; --muted: #666; }
@media (prefers-color-scheme: dark) { :root { --bg: #111; --fg: #eee; --muted: #999; } }
body { background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 52rem; padding: 1rem; }
p { color: var(--muted); }
`;

// The skeleton page: proves the service is up and which database role it runs
// as. The data views come next.
export function renderPage(db: Db) {
  return async (): Promise<string> => {
    const { rows } = await db.query<{ role: string }>(
      "SELECT current_user AS role",
    );
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Personal Ops</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<h1>Personal Ops</h1>
<p>Read-only dashboard. Database role: ${esc(rows[0]?.role)}</p>
</body>
</html>
`;
  };
}
