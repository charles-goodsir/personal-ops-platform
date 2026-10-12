import { z } from "zod";

const BASE_URL = "https://api.akahu.io/v1/";
const REQUEST_TIMEOUT_MS = 30_000;
// 100 a page, so this is 50,000 transactions: far more than I have. A response
// that never ends must stop here, not fill the memory.
const MAX_PAGES = 500;

// Only the fields we use. formatted_account (the account number) and
// meta.holder (my name) are deliberately not parsed, so they can't be stored.
const account = z.object({
  _id: z.string(),
  name: z.string(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  type: z.string(),
  connection: z.object({ name: z.string() }),
  balance: z
    .object({
      currency: z.string(),
      current: z.number(),
      available: z.number().optional(),
    })
    .optional(),
  refreshed: z.object({ transactions: z.string().optional() }).optional(),
});

export type AkahuAccount = z.infer<typeof account>;

const accountsResponse = z.object({ items: z.array(account) });

// meta is not parsed at all: it holds meta.other_account (someone's account
// number) and meta.card_suffix.
const transaction = z.object({
  _id: z.string(),
  _account: z.string(),
  date: z.string(),
  description: z.string(),
  amount: z.number(),
  type: z.string(),
  merchant: z.object({ name: z.string() }).optional(),
  category: z
    .object({
      name: z.string(),
      groups: z
        .object({ personal_finance: z.object({ name: z.string() }).optional() })
        .optional(),
    })
    .optional(),
});

export type AkahuTransaction = z.infer<typeof transaction>;

const transactionsPage = z.object({
  items: z.array(transaction),
  cursor: z.object({ next: z.string().nullable() }).optional(),
});

export function createAkahuClient(opts: {
  appToken: string;
  userToken: string;
  baseUrl?: string;
}) {
  async function get(
    path: string,
    params: Record<string, string> = {},
  ): Promise<unknown> {
    const url = new URL(path, opts.baseUrl ?? BASE_URL);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${opts.userToken}`,
          "X-Akahu-Id": opts.appToken,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Nothing from the original error is passed on: it could carry a header.
      throw new Error(`Akahu ${path} failed: no response`);
    }
    const body: unknown = await res.json().catch(() => undefined);
    if (!res.ok) {
      // Akahu errors are { success: false, message }. Never include headers.
      const message = z.object({ message: z.string() }).safeParse(body);
      throw new Error(
        `Akahu ${path} failed: ${res.status} ${message.success ? message.data.message : ""}`.trim(),
      );
    }
    return body;
  }

  return {
    async listAccounts(): Promise<AkahuAccount[]> {
      return accountsResponse.parse(await get("accounts")).items;
    },

    // Settled transactions with date in (start, end]: Akahu's start is
    // exclusive. Follows the cursor until the last page, 100 per page.
    async listTransactions(
      start: Date,
      end: Date,
    ): Promise<AkahuTransaction[]> {
      const range = { start: start.toISOString(), end: end.toISOString() };
      const all: AkahuTransaction[] = [];
      let cursor: string | null = null;
      const seen = new Set<string>();
      do {
        if (seen.size >= MAX_PAGES) {
          throw new Error("Akahu transactions failed: too many pages");
        }
        if (cursor) {
          if (seen.has(cursor)) {
            throw new Error("Akahu transactions failed: cursor repeated");
          }
          seen.add(cursor);
        }
        const page = transactionsPage.parse(
          await get("transactions", cursor ? { ...range, cursor } : range),
        );
        all.push(...page.items);
        cursor = page.cursor?.next ?? null;
      } while (cursor);
      return all;
    },
  };
}

export type AkahuClient = ReturnType<typeof createAkahuClient>;
