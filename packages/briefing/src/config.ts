import { z } from "zod";

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[\w-]+$/),
  // A private chat is a positive number; a group is negative.
  TELEGRAM_CHAT_ID: z.string().regex(/^-?\d+$/),
  // When the briefing goes out, 24-hour NZ time.
  BRIEFING_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("08:30"),
  WEATHER_LAT: z.coerce.number().min(-90).max(90),
  WEATHER_LON: z.coerce.number().min(-180).max(180),
});

export type BriefingConfig = z.infer<typeof schema>;

// Errors name the variable, never its value.
export function loadBriefingConfig(
  env: NodeJS.ProcessEnv = process.env,
): BriefingConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(`Invalid briefing config:\n  ${issues.join("\n  ")}`);
  }
  return result.data;
}
