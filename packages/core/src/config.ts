import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  OLLAMA_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:11434"),
  EMBED_MODEL: z.string().min(1).default("nomic-embed-text"),
  NOTES_DIR: z.string().min(1).default("./notes"),
});

export type Config = z.infer<typeof schema>;

// Fails fast at startup with every bad or missing variable listed, never their values.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(`Invalid config:\n  ${issues.join("\n  ")}`);
  }
  return result.data;
}
