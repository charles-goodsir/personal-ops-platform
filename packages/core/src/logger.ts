import { pino, type DestinationStream, type Logger } from "pino";
import type { Config } from "./config.js";

export type { Logger };

// Key names censored wherever they sit in a logged object, up to three levels
// down: the names I use for settings (a config object logged by mistake), and the
// header names that carry credentials, in either case.
const SECRET_KEYS = [
  "password",
  "token",
  "authorization",
  "Authorization",
  "cookie",
  "Cookie",
  "set-cookie",
  "x-api-key",
  "X-Akahu-Id",
  "apiKey",
  "pingUrl",
  "DATABASE_URL",
  "POSTGRES_PASSWORD",
  "TELEGRAM_BOT_TOKEN",
  "MCP_AUTH_TOKENS",
  "ANTHROPIC_API_KEY",
  "AKAHU_APP_TOKEN",
  "AKAHU_USER_TOKEN",
  "HEALTHCHECK_PING_URL",
  "accountNumber",
];

// pino paths: a plain name, or bracket notation for one with a hyphen.
const at = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `["${k}"]`);
const REDACT = SECRET_KEYS.flatMap((k) => [
  at(k).replace(/^\./, ""),
  `*${at(k)}`,
  `*.*${at(k)}`,
  `*.*.*${at(k)}`,
]);

export function createLogger(
  config: Pick<Config, "LOG_LEVEL">,
  destination?: DestinationStream,
): Logger {
  const options = {
    level: config.LOG_LEVEL,
    redact: REDACT,
  };
  return destination ? pino(options, destination) : pino(options);
}
