import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CATEGORIES } from "./categories.js";
import type { Classifier } from "./categorise.js";

const Output = z.object({
  results: z.array(
    z.object({ id: z.number().int(), category: z.enum(CATEGORIES) }),
  ),
});

// Written by hand: the SDK's zod helper (0.128) turns z.enum into a
// description, so the API would only be hinted at the category list instead
// of constrained to it. zod still validates the reply.
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          category: { type: "string", enum: [...CATEGORIES] },
        },
        required: ["id", "category"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

const SYSTEM = `You categorise transactions from my New Zealand bank accounts.
Each item has a number, a description, an amount (negative is money out), the
transaction type, and sometimes a merchant name and a category from my bank's
data provider. Pick exactly one category per item from the allowed list.
Money moved between my own accounts, and credit card repayments, are Transfers.
Salary, interest earned and refunds are Income. Use Other only when nothing fits.
Return one result for every item.`;

export function createClaudeClassifier(opts: {
  apiKey: string;
  model: string;
}): Classifier {
  const client = new Anthropic({ apiKey: opts.apiKey });
  return async (items) => {
    const response = await client.messages.create({
      model: opts.model,
      max_tokens: 8000,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: OUTPUT_SCHEMA },
      },
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(items) }],
    });
    const text = response.content.find((b) => b.type === "text");
    if (response.stop_reason !== "end_turn" || !text) {
      throw new Error(
        `categorisation stopped: ${response.stop_reason ?? "unknown"}`,
      );
    }
    return Output.parse(JSON.parse(text.text)).results;
  };
}
