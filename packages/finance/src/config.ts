import { z } from "zod";

const schema = z.object({
  AKAHU_APP_TOKEN: z.string().startsWith("app_token_"),
  AKAHU_USER_TOKEN: z.string().startsWith("user_token_"),
  // Optional: without it, sync and rules still run and the model step is skipped.
  // Compose passes an unset variable as "", so empty counts as not set.
  ANTHROPIC_API_KEY: z
    .union([z.string().startsWith("sk-ant-"), z.literal("")])
    .optional(),
  CLAUDE_BULK_MODEL: z.string().min(1).default("claude-haiku-5-5"),
  // Optional: without both, the sync runs and budget alerts are skipped.
  TELEGRAM_BOT_TOKEN: z
    .union([z.string().regex(/^\d+:[\w-]+$/), z.literal("")])
    .optional(),
  TELEGRAM_CHAT_ID: z
    .union([z.string().regex(/^-?\d+$/), z.literal("")])
    .optional(),
  // Earliest transaction date to fetch and keep. Akahu stamps a transaction
  // at 23:59 NZ time on its date, so a plain date splits days correctly.
  // When the daily sync runs, 24-hour NZ time.
  FINANCE_SYNC_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("08:00"),
  // A second, quiet sync just after midnight, so the day that has just ended
  // is in before anything else looks. Empty turns it off.
  FINANCE_NIGHT_SYNC_TIME: z
    .union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal("")])
    .default("00:05"),
  FINANCE_HISTORY_START: z.iso
    .date()
    .default("2026-01-01")
    .transform((d) => new Date(d)),
});

export type FinanceConfig = z.infer<typeof schema>;

// Only the finance code needs the Akahu tokens, so they're checked here
// rather than in core's config. Errors name the variable, never its value.
export function loadFinanceConfig(
  env: NodeJS.ProcessEnv = process.env,
): FinanceConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(`Invalid finance config:\n  ${issues.join("\n  ")}`);
  }
  return result.data;
}

const summarySchema = z.object({
  // Optional: without a key the summary is still sent, as plain numbers.
  ANTHROPIC_API_KEY: z
    .union([z.string().startsWith("sk-ant-"), z.literal("")])
    .optional(),
  CLAUDE_SUMMARY_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[\w-]+$/),
  // A private chat is a positive number; a group is negative.
  TELEGRAM_CHAT_ID: z.string().regex(/^-?\d+$/),
});

export type SummaryConfig = z.infer<typeof summarySchema>;

// The weekly summary needs Telegram but not Akahu, so it loads its own config.
export function loadSummaryConfig(
  env: NodeJS.ProcessEnv = process.env,
): SummaryConfig {
  const result = summarySchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(`Invalid summary config:\n  ${issues.join("\n  ")}`);
  }
  return result.data;
}
