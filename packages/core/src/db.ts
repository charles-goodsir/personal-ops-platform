import pg from "pg";
import type { Config } from "./config.js";

export type Db = pg.Pool;

export function createDb(config: Pick<Config, "DATABASE_URL">): Db {
  return new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });
}

export async function checkDb(db: Db): Promise<boolean> {
  const { rows } = await db.query<{ ok: number }>("select 1 as ok");
  return rows[0]?.ok === 1;
}
