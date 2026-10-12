import { expect, test, vi } from "vitest";
import { pingHealthcheck } from "./healthcheck.js";

const url = "https://hc-ping.com/11111111-2222-3333-4444-555555555555";

test("sends one GET to the ping url", async () => {
  const fetchFn = vi.fn<typeof fetch>(async () => new Response("OK"));
  await pingHealthcheck({ url, fetchFn });
  expect(fetchFn).toHaveBeenCalledTimes(1);
  expect(fetchFn.mock.calls[0]?.[0]).toBe(url);
  expect(fetchFn.mock.calls[0]?.[1]?.method).toBeUndefined();
});

test("errors never carry the url, for a bad status or a dead network", async () => {
  const bad = vi.fn<typeof fetch>(
    async () => new Response("no", { status: 404 }),
  );
  const down = vi.fn<typeof fetch>(async () => {
    throw new TypeError(`fetch failed: ${url}`);
  });
  const e1 = await pingHealthcheck({ url, fetchFn: bad }).catch(
    (e: Error) => e,
  );
  const e2 = await pingHealthcheck({ url, fetchFn: down }).catch(
    (e: Error) => e,
  );
  expect(e1).toMatchObject({ message: "healthcheck ping failed: 404" });
  expect(e2).toMatchObject({ message: "healthcheck ping failed: no response" });
  expect(JSON.stringify([String(e1), String(e2)])).not.toContain("hc-ping");
});

test("gives up after the timeout", async () => {
  const hang = vi.fn<typeof fetch>(
    (_u, init) =>
      new Promise((_r, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("x")));
      }),
  );
  await expect(
    pingHealthcheck({ url, fetchFn: hang, timeoutMs: 20 }),
  ).rejects.toThrow("no response");
});
