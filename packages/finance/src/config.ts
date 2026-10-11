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
