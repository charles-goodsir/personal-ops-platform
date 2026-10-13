import { z } from "zod";

const csv = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

const schema = z.object({
  DASHBOARD_HOST: z.string().default("127.0.0.1"),
  DASHBOARD_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  // Host names the page answers to. Through an SSH tunnel it is "localhost".
  DASHBOARD_ALLOWED_HOSTS: z
    .string()
    .default("localhost,127.0.0.1")
    .transform(csv),
  // "true" shows "Subscription 1" in place of payee names, for screenshots.
  DASHBOARD_HIDE_PAYEES: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  DASHBOARD_PASSWORD: z.string().min(20, "must be at least 20 characters"),
});

export type DashboardConfig = z.infer<typeof schema>;

// Errors name the variable, never its value.
export function loadDashboardConfig(
  env: NodeJS.ProcessEnv = process.env,
): DashboardConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(`Invalid dashboard config:\n  ${issues.join("\n  ")}`);
  }
  return result.data;
}

// Every connection starts as the read-only role: SELECT on four tables, no
// writes. Added to any options the URL already has.
export function readOnlyUrl(url: string): string {
  const u = new URL(url);
  const options = [u.searchParams.get("options"), "-c role=dashboard_ro"];
  u.searchParams.set("options", options.filter(Boolean).join(" "));
  return u.href;
}
