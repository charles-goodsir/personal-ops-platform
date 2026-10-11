import { z } from "zod";

const schema = z.object({
  AKAHU_APP_TOKEN: z.string().startsWith("app_token_"),
  AKAHU_USER_TOKEN: z.string().startsWith("user_token_"),
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
