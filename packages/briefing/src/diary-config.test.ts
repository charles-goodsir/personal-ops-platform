import { expect, test } from "vitest";
import { loadDiaryConfig } from "./diary-config.js";

const env = {
  TELEGRAM_BOT_TOKEN: "123456:abc-DEF_x",
  TELEGRAM_CHAT_ID: "9876",
};

test("defaults to 09:00, takes a valid time, and rejects a bad one without echoing it", () => {
  expect(loadDiaryConfig(env).DIARY_TIME).toBe("09:00");
  expect(loadDiaryConfig({ ...env, DIARY_TIME: "06:45" }).DIARY_TIME).toBe(
    "06:45",
  );
  const err = (() => {
    try {
      loadDiaryConfig({ ...env, DIARY_TIME: "25:99" });
    } catch (e) {
      return e as Error;
    }
  })();
  expect(err?.message).toContain("DIARY_TIME");
  expect(err?.message).not.toContain("25:99");
});
