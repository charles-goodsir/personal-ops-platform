// Tells an outside dead-man's switch (Healthchecks.io) that this box is alive.
// The URL's random id is the secret, so errors carry a status or a fixed
// message, never the URL, and a slow or dead service can't hold a caller up.
export async function pingHealthcheck(opts: {
  url: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): Promise<void> {
  const doFetch = opts.fetchFn ?? fetch;
  let res: Response;
  try {
    res = await doFetch(opts.url, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
  } catch {
    throw new Error("healthcheck ping failed: no response");
  }
  if (!res.ok) throw new Error(`healthcheck ping failed: ${res.status}`);
}
