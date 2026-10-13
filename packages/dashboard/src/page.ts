import type { Db } from "@ops/core";
import { loadDashboard } from "./data.js";
import { renderDashboard } from "./render.js";

export { CSS } from "./style.js";

export function renderPage(
  db: Db,
  opts: { hidePayees: boolean; now?: () => Date },
) {
  return async (): Promise<string> => {
    const [data, role] = await Promise.all([
      loadDashboard(db, opts.now?.()),
      db.query<{ role: string }>("SELECT current_user AS role"),
    ]);
    return renderDashboard(data, {
      role: role.rows[0]?.role ?? "unknown",
      hidePayees: opts.hidePayees,
    });
  };
}
