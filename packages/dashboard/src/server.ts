import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestListener, ServerResponse } from "node:http";
import type { Logger } from "@ops/core";

const digest = (s: string) => createHash("sha256").update(s).digest();

// Nothing is loaded from anywhere but this server, and nothing can frame it.
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
};

function send(
  res: ServerResponse,
  status: number,
  type: string,
  body: string,
  extra: Record<string, string> = {},
) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": `${type}; charset=utf-8`,
    ...extra,
  });
  res.end(body);
}

// "Localhost:3100" -> "localhost". Only a plain name or address with an
// optional port is read. Nothing is normalised (URL parsing turns "127.1" into
// "127.0.0.1"), so a different spelling of an allowed host is refused.
function hostName(header: string | undefined): string | undefined {
  return /^([a-z0-9.-]+|\[[0-9a-f:]+\])(:\d{1,5})?$/.exec(
    header?.toLowerCase() ?? "",
  )?.[1];
}

// The first thing every request meets, in this order: Host name, method, the
// password, then a fixed list of two paths. There is no file lookup, no query
// handling and no write route. Failed passwords are logged at most once every
// 10 seconds, with a count and never what was sent.
export function createDashboardHandler(opts: {
  password: string;
  allowedHosts: string[];
  logger: Pick<Logger, "warn" | "error">;
  page: () => Promise<string>;
  css: string;
  now?: () => number;
}): RequestListener {
  const expected = digest(opts.password);
  const now = opts.now ?? Date.now;
  let failures = 0;
  let lastLogged = -Infinity;

  return (req, res) => {
    const host = hostName(req.headers.host);
    if (!host || !opts.allowedHosts.includes(host))
      return send(res, 403, "text/plain", "forbidden");

    if (req.method !== "GET" && req.method !== "HEAD")
      return send(res, 405, "text/plain", "method not allowed", {
        Allow: "GET, HEAD",
      });

    // The user name is ignored: there is one password.
    const basic = /^Basic ([A-Za-z0-9+/]+=*)$/.exec(
      req.headers.authorization ?? "",
    );
    const decoded = basic?.[1]
      ? Buffer.from(basic[1], "base64").toString("utf8")
      : undefined;
    const colon = decoded?.indexOf(":") ?? -1;
    const given =
      decoded !== undefined && colon >= 0
        ? digest(decoded.slice(colon + 1))
        : undefined;
    if (!given || !timingSafeEqual(expected, given)) {
      failures++;
      if (now() - lastLogged >= 10_000) {
        opts.logger.warn(
          { failures, ip: req.socket.remoteAddress },
          "dashboard auth failed",
        );
        failures = 0;
        lastLogged = now();
      }
      return send(res, 401, "text/plain", "unauthorized", {
        "WWW-Authenticate": 'Basic realm="dashboard", charset="UTF-8"',
      });
    }

    const path = (req.url ?? "").split("?")[0];
    if (path === "/style.css") return send(res, 200, "text/css", opts.css);
    if (path !== "/") return send(res, 404, "text/plain", "not found");
    opts
      .page()
      .then((html) => send(res, 200, "text/html", html))
      .catch((err: unknown) => {
        opts.logger.error({ err }, "dashboard page failed");
        send(res, 500, "text/plain", "internal error");
      });
  };
}
