import { pino, type DestinationStream, type Logger } from "pino";
import type { Config } from "./config.js";

export type { Logger };

// Keys censored wherever they appear at the top level or one level down.
const SECRET_KEYS = [
  "password",
  "token",
  "authorization",
  "apiKey",
  "DATABASE_URL",
  "accountNumber",
];

export function createLogger(
  config: Pick<Config, "LOG_LEVEL">,
  destination?: DestinationStream,
): Logger {
  const options = {
    level: config.LOG_LEVEL,
    redact: SECRET_KEYS.flatMap((k) => [k, `*.${k}`]),
  };
  return destination ? pino(options, destination) : pino(options);
}
