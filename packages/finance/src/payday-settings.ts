import type { Db } from "@ops/core";

// The items I set from the bot, and the column each one lives in. The column
// name that reaches the SQL always comes from this table, never from input.
const COLUMN = {
  pay: "pay",
  rent: "rent_bills",
  savings: "savings",
  invest: "investments",
  spending: "spending_target",
} as const;
export type SettingItem = keyof typeof COLUMN;
export const SETTING_ITEMS = Object.keys(COLUMN) as SettingItem[];

const MAX_AMOUNT = 1_000_000;

export type PaydaySettings = {
  pay: number | null;
  rent: number | null;
  savings: number | null;
  invest: number | null;
  spending: number | null;
  payday: string | null; // "YYYY-MM-DD", the date of one payday
};

const num = (v: string | null) => (v === null ? null : Number(v));

// A real calendar date between the years 2000 and 2100, as "YYYY-MM-DD".
export function validDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = m ? new Date(`${value}T00:00:00Z`) : undefined;
  if (
    !m ||
    !d ||
    Number.isNaN(d.getTime()) ||
    d.toISOString().slice(0, 10) !== value ||
    Number(m[1]) < 2000 ||
    Number(m[1]) > 2099
  )
    throw new Error("date must be a real date written YYYY-MM-DD");
  return value;
}

// Payday settings from chat: the only writer is the bot, and each one is a
// bounded number or a date.
export function createPaydaySettingsApi(db: Db) {
  return {
    async getSettings(): Promise<PaydaySettings> {
      const { rows } = await db.query<{
        pay: string | null;
        rent_bills: string | null;
        savings: string | null;
        investments: string | null;
        spending_target: string | null;
        pay_anchor: string | null;
      }>(
        `SELECT pay, rent_bills, savings, investments, spending_target,
                to_char(pay_anchor, 'YYYY-MM-DD') AS pay_anchor
         FROM payday_settings`,
      );
      const r = rows[0];
      return {
        pay: num(r?.pay ?? null),
        rent: num(r?.rent_bills ?? null),
        savings: num(r?.savings ?? null),
        invest: num(r?.investments ?? null),
        spending: num(r?.spending_target ?? null),
        payday: r?.pay_anchor ?? null,
      };
    },

    async setAmount(item: SettingItem, amount: number) {
      // Checked here too: the bot's own parsing isn't the only possible caller.
      if (!Object.hasOwn(COLUMN, item))
        throw new Error(`unknown item: ${item}`);
      if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT)
        throw new Error(`amount must be more than 0 and at most ${MAX_AMOUNT}`);
      const value = Math.round(amount * 100) / 100;
      const column = COLUMN[item];
      await db.query(
        `INSERT INTO payday_settings (id, ${column}) VALUES (true, $1)
         ON CONFLICT (id) DO UPDATE SET ${column} = EXCLUDED.${column}, updated_at = now()`,
        [value],
      );
      return { item, amount: value };
    },

    async setPayday(date: string) {
      const value = validDate(date);
      await db.query(
        `INSERT INTO payday_settings (id, pay_anchor) VALUES (true, $1)
         ON CONFLICT (id) DO UPDATE SET pay_anchor = EXCLUDED.pay_anchor, updated_at = now()`,
        [value],
      );
      return { payday: value };
    },
  };
}

export type PaydaySettingsApi = ReturnType<typeof createPaydaySettingsApi>;
