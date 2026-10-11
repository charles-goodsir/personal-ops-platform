import { afterEach, expect, test, vi } from "vitest";
import { createAkahuClient } from "./akahu.js";

const appToken = "app_token_abc";
const userToken = "user_token_secret";
const akahu = createAkahuClient({ appToken, userToken });

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

const apiAccount = {
  _id: "acc_1",
  _authorisation: "authorisation_1",
  name: "Everyday",
  status: "ACTIVE",
  type: "CHECKING",
  formatted_account: "01-0123-0123456-00",
  connection: { _id: "conn_1", name: "ANZ", logo: "https://x" },
  balance: { currency: "NZD", current: 120.5, available: 100 },
  refreshed: { transactions: "2026-10-11T00:00:00Z" },
  meta: { holder: "Charles Goodsir" },
};

test("sends both tokens in the headers Akahu expects", async () => {
  const fetch = mockFetch(200, { success: true, items: [] });
  await akahu.listAccounts();
  const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.href).toBe("https://api.akahu.io/v1/accounts");
  expect(init.headers).toEqual({
    Authorization: `Bearer ${userToken}`,
    "X-Akahu-Id": appToken,
  });
});

test("drops the account number and holder name", async () => {
  mockFetch(200, { success: true, items: [apiAccount] });
  const [account] = await akahu.listAccounts();
  expect(account).toMatchObject({ _id: "acc_1", connection: { name: "ANZ" } });
  expect(JSON.stringify(account)).not.toMatch(/0123456|Goodsir/);
});

test("errors carry Akahu's message, never the tokens", async () => {
  mockFetch(401, { success: false, message: "Permission Denied" });
  const message = await akahu.listAccounts().then(
    () => "no error",
    (e: unknown) => (e instanceof Error ? e.message : String(e)),
  );
  expect(message).toBe("Akahu accounts failed: 401 Permission Denied");
  expect(message).not.toMatch(/secret|abc/);
});
