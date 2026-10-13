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

const apiTransaction = (id: string) => ({
  _id: id,
  _account: "acc_1",
  _connection: "conn_1",
  _user: "user_1",
  date: "2026-10-01T00:00:00.000Z",
  description: "COUNTDOWN AUCKLAND",
  amount: -42.5,
  type: "EFTPOS",
  merchant: { _id: "merchant_1", name: "Countdown" },
  category: {
    _id: "cat_1",
    name: "Supermarkets and grocery stores",
    groups: { personal_finance: { _id: "g_1", name: "Food" } },
  },
  meta: { other_account: "12-3456-7890123-00", card_suffix: "4321" },
});

test("follows the cursor and keeps the date range on every page", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [apiTransaction("t1")],
          cursor: { next: "c2" },
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [apiTransaction("t2")],
          cursor: { next: null },
        }),
      ),
    );
  vi.stubGlobal("fetch", fetch);
  const start = new Date("2026-09-01T00:00:00Z");
  const end = new Date("2026-10-01T00:00:00Z");
  const items = await akahu.listTransactions(start, end);

  expect(items.map((t) => t._id)).toEqual(["t1", "t2"]);
  const urls = fetch.mock.calls.map(([u]) => (u as URL).searchParams);
  expect(urls[0]?.get("start")).toBe(start.toISOString());
  expect(urls[0]?.get("cursor")).toBeNull();
  expect(urls[1]?.get("cursor")).toBe("c2");
  expect(urls[1]?.get("end")).toBe(end.toISOString());
});

test("drops other people's account numbers and the card suffix", async () => {
  mockFetch(200, { items: [apiTransaction("t1")], cursor: { next: null } });
  const [t] = await akahu.listTransactions(new Date(0), new Date());
  expect(t).toMatchObject({ merchant: { name: "Countdown" } });
  expect(JSON.stringify(t)).not.toMatch(/7890123|4321/);
});

test("refresh posts to /refresh with a JSON body and both tokens", async () => {
  const fetch = mockFetch(200, { success: true });
  await akahu.refresh();
  const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.href).toBe("https://api.akahu.io/v1/refresh");
  expect(init.method).toBe("POST");
  expect(init.body).toBe("{}");
  expect(init.headers).toEqual({
    Authorization: `Bearer ${userToken}`,
    "X-Akahu-Id": appToken,
    "Content-Type": "application/json",
  });
});

test("a rate limited refresh says so and never carries a token", async () => {
  mockFetch(429, {
    success: false,
    message: "Refresh initiated within last 5 minutes",
  });
  const err = await akahu.refresh().catch((e: Error) => e);
  expect((err as Error).message).toBe(
    "Akahu refresh failed: 429 Refresh initiated within last 5 minutes",
  );
  expect((err as Error).message).not.toContain(userToken);
});
