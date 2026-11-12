import { expect, test } from "vitest";
import { loadIsoConfig } from "./iso-config.js";

const env = {
  TELEGRAM_BOT_TOKEN: "123456:abc-DEF_x",
  TELEGRAM_CHAT_ID: "9876",
  ISO_START: "2026-11-14",
};

test("defaults to 09:30, takes a valid time, and rejects a bad one without echoing it", () => {
  expect(loadIsoConfig(env).ISO_TIME).toBe("09:30");
  expect(loadIsoConfig({ ...env, ISO_TIME: "06:45" }).ISO_TIME).toBe("06:45");
  const err = (() => {
    try {
      loadIsoConfig({ ...env, ISO_TIME: "25:99" });
    } catch (e) {
      return e as Error;
    }
  })();
  expect(err?.message).toContain("ISO_TIME");
  expect(err?.message).not.toContain("25:99");
});

test("the start date is required and must look like a date", () => {
  expect(() => loadIsoConfig({ ...env, ISO_START: undefined })).toThrow(
    "ISO_START",
  );
  expect(() => loadIsoConfig({ ...env, ISO_START: "tomorrow" })).toThrow(
    "ISO_START",
  );
});
