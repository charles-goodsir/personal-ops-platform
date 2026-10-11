import { z } from "zod";

const BASE_URL = "https://api.akahu.io/v1/";

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

export function createAkahuClient(opts: {
  appToken: string;
  userToken: string;
  baseUrl?: string;
}) {
  async function get(path: string): Promise<unknown> {
    const res = await fetch(new URL(path, opts.baseUrl ?? BASE_URL), {
      headers: {
        Authorization: `Bearer ${opts.userToken}`,
        "X-Akahu-Id": opts.appToken,
      },
    });
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
  };
}

export type AkahuClient = ReturnType<typeof createAkahuClient>;
