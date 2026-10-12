import { createHash, timingSafeEqual } from "node:crypto";
import type { Logger } from "@ops/core";
import type { RequestHandler } from "express";

const digest = (s: string) => createHash("sha256").update(s).digest();

// Bearer token check. Several tokens can be valid at once so one can be rotated
// in before the old one is removed. Hashing first gives equal-length buffers for
// a constant-time compare. Failures are logged at most once every 10 seconds,
// with how many there were and where from, never what was sent: a stranger
// guessing is visible to me, and can't fill the disk by guessing fast.
export function bearerAuth(
  tokens: string[],
  logger?: Pick<Logger, "warn">,
  now: () => number = Date.now,
): RequestHandler {
  const expected = tokens.map(digest);
  let failures = 0;
  let lastLogged = -Infinity;
  return (req, res, next) => {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
    const given = match?.[1] ? digest(match[1]) : undefined;
    if (given && expected.some((e) => timingSafeEqual(e, given))) return next();
    failures++;
    if (logger && now() - lastLogged >= 10_000) {
      logger.warn({ failures, ip: req.ip }, "mcp auth failed");
      failures = 0;
      lastLogged = now();
    }
    res
      .set("WWW-Authenticate", "Bearer")
      .status(401)
      .json({ error: "unauthorized" });
  };
}
