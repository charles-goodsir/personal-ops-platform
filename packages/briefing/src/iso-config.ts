import { z } from "zod";

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[\w-]+$/),
  TELEGRAM_CHAT_ID: z.string().regex(/^-?\d+$/),
  // When the day's ISO 27001 entry goes out, 24-hour NZ time. After the diary
  // message, so the three arrive in order.
  ISO_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("09:30"),
  // The first day's entry is sent on this NZ date, "YYYY-MM-DD", then one a day
  // in order. Required, so the start is a decision and not a default.
  ISO_START: z.string().regex(/^\d{4}-\d\d-\d\d$/),
});

export type IsoConfig = z.infer<typeof schema>;

// Errors name the variable, never its value.
export function loadIsoConfig(env: NodeJS.ProcessEnv = process.env): IsoConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(`Invalid ISO config:\n  ${issues.join("\n  ")}`);
  }
  return result.data;
}
