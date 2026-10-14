import type { Db } from "@ops/core";
import { validDate } from "./payday-settings.js";

const MAX_TARGET = 10_000_000;
const MAX_NAME = 40;

export type Goal = {
  name: string;
  target: number;
  saved: number;
  weight: number;
  due: string | null; // "YYYY-MM-DD"
};

// Letters, digits, spaces and a few marks, starting with a letter or digit.
// No control characters, so a name can't forge a line in the list, and no
// angle brackets or quotes that matter to a page.
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} .,&()'/-]*$/u;

// One space between words, none at the ends. Names match without regard to case.
export function normaliseName(name: string): string {
  const n = name.trim().replace(/\s+/g, " ");
  if (n.length < 1 || n.length > MAX_NAME)
    throw new Error(`name must be 1 to ${MAX_NAME} characters`);
  if (!NAME.test(n))
    throw new Error(
      "name can use letters, digits, spaces and . , & ( ) ' / - only",
    );
  return n;
}

const money = (n: number, what: string, min: number) => {
  if (!Number.isFinite(n) || n < min || n > MAX_TARGET)
    throw new Error(
      `${what} must be at least ${min} and at most ${MAX_TARGET}`,
    );
  return Math.round(n * 100) / 100;
};

type Row = {
  name: string;
  target: string;
  saved: string;
  weight: number;
  due: string | null;
};
const toGoal = (r: Row): Goal => ({
  name: r.name,
  target: Number(r.target),
  saved: Number(r.saved),
  weight: r.weight,
  due: r.due,
});
const COLUMNS = `name, target, saved, weight, to_char(due, 'YYYY-MM-DD') AS due`;

// Savings goals from chat. "saved" is what I tell the bot, set rather than
// added to, so a typo sent twice does no harm.
export function createGoalsApi(db: Db) {
  return {
    async addGoal(input: {
      name: string;
      target: number;
      due?: string;
      weight?: number;
    }): Promise<Goal> {
      const name = normaliseName(input.name);
      const target = money(input.target, "target", 0.01);
      const due = input.due === undefined ? null : validDate(input.due);
      const weight = input.weight ?? 1;
      if (!Number.isInteger(weight) || weight < 1 || weight > 10)
        throw new Error("weight must be a whole number from 1 to 10");
      try {
        const { rows } = await db.query<Row>(
          `INSERT INTO goals (name, target, weight, due) VALUES ($1, $2, $3, $4)
           RETURNING ${COLUMNS}`,
          [name, target, weight, due],
        );
        return toGoal(rows[0] as Row);
      } catch (err) {
        if ((err as { code?: string }).code === "23505")
          throw new Error(`a goal called ${name} already exists`, {
            cause: err,
          });
        throw err;
      }
    },

    async listGoals(): Promise<Goal[]> {
      const { rows } = await db.query<Row>(
        `SELECT ${COLUMNS} FROM goals ORDER BY created_at, id`,
      );
      return rows.map(toGoal);
    },

    // Null when there is no goal by that name.
    async setSaved(name: string, saved: number): Promise<Goal | null> {
      const value = money(saved, "saved", 0);
      const { rows } = await db.query<Row>(
        `UPDATE goals SET saved = $2 WHERE lower(name) = lower($1)
         RETURNING ${COLUMNS}`,
        [normaliseName(name), value],
      );
      return rows[0] ? toGoal(rows[0]) : null;
    },

    async setWeight(name: string, weight: number): Promise<Goal | null> {
      if (!Number.isInteger(weight) || weight < 1 || weight > 10)
        throw new Error("weight must be a whole number from 1 to 10");
      const { rows } = await db.query<Row>(
        `UPDATE goals SET weight = $2 WHERE lower(name) = lower($1)
         RETURNING ${COLUMNS}`,
        [normaliseName(name), weight],
      );
      return rows[0] ? toGoal(rows[0]) : null;
    },

    async removeGoal(name: string): Promise<boolean> {
      const { rowCount } = await db.query(
        "DELETE FROM goals WHERE lower(name) = lower($1)",
        [normaliseName(name)],
      );
      return Boolean(rowCount);
    },
  };
}

export type GoalsApi = ReturnType<typeof createGoalsApi>;
