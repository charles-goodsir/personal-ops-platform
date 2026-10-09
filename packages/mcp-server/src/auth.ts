import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

const digest = (s: string) => createHash("sha256").update(s).digest();

// Bearer token check. Several tokens can be valid at once so one can be rotated
// in before the old one is removed. Hashing first gives equal-length buffers for
// a constant-time compare.
export function bearerAuth(tokens: string[]): RequestHandler {
  const expected = tokens.map(digest);
  return (req, res, next) => {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
    const given = match?.[1] ? digest(match[1]) : undefined;
    if (given && expected.some((e) => timingSafeEqual(e, given))) return next();
    res
      .set("WWW-Authenticate", "Bearer")
      .status(401)
      .json({ error: "unauthorized" });
  };
}
