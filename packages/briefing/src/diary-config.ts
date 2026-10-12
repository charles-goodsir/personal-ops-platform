import { z } from "zod";

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[\w-]+$/),
  TELEGRAM_CHAT_ID: z.string().regex(/^-?\d+$/),
  // When yesterday's diary message goes out, 24-hour NZ time. Just after the
  // briefing, so the two arrive in order.
  DIARY_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("09:00"),
});

export type DiaryConfig = z.infer<typeof schema>;

// Errors name the variable, never its value.
export function loadDiaryConfig(
  env: NodeJS.ProcessEnv = process.env,
): DiaryConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(`Invalid diary config:\n  ${issues.join("\n  ")}`);
  }
  return result.data;
}
