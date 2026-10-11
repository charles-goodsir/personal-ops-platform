import { expect, test } from "vitest";
import { loadFinanceConfig } from "./config.js";

test("accepts tokens with Akahu's prefixes", () => {
  expect(
    loadFinanceConfig({
      AKAHU_APP_TOKEN: "app_token_x",
      AKAHU_USER_TOKEN: "user_token_y",
    }),
  ).toEqual({
    AKAHU_APP_TOKEN: "app_token_x",
    AKAHU_USER_TOKEN: "user_token_y",
    CLAUDE_BULK_MODEL: "claude-haiku-5-5",
    FINANCE_HISTORY_START: new Date("2026-01-01T00:00:00Z"),
  });
});

test("rejects swapped or missing tokens without echoing them", () => {
  const swapped = () =>
    loadFinanceConfig({
      AKAHU_APP_TOKEN: "user_token_oops",
      AKAHU_USER_TOKEN: "app_token_oops",
    });
  expect(swapped).toThrow(/AKAHU_APP_TOKEN[\s\S]*AKAHU_USER_TOKEN/);
  expect(swapped).toThrow(
    expect.not.objectContaining({ message: expect.stringContaining("oops") }),
  );
  expect(() => loadFinanceConfig({})).toThrow(/AKAHU_APP_TOKEN/);
});

const tokens = {
  AKAHU_APP_TOKEN: "app_token_x",
  AKAHU_USER_TOKEN: "user_token_y",
};

test("an empty API key from Compose counts as not set", () => {
  expect(
    loadFinanceConfig({ ...tokens, ANTHROPIC_API_KEY: "" }).ANTHROPIC_API_KEY,
  ).toBeFalsy();
});

test("rejects a malformed API key without echoing it", () => {
  const bad = () =>
    loadFinanceConfig({ ...tokens, ANTHROPIC_API_KEY: "oops-key" });
  expect(bad).toThrow(/ANTHROPIC_API_KEY/);
  expect(bad).toThrow(
    expect.not.objectContaining({ message: expect.stringContaining("oops") }),
  );
});

test("the history start must be a plain date", () => {
  expect(() =>
    loadFinanceConfig({ ...tokens, FINANCE_HISTORY_START: "last year" }),
  ).toThrow(/FINANCE_HISTORY_START/);
});
