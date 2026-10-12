import { expect, test } from "vitest";
import { loadBriefingConfig } from "./config.js";

const env = {
  TELEGRAM_BOT_TOKEN: "123456:abc-DEF_x",
  TELEGRAM_CHAT_ID: "987654321",
  WEATHER_LAT: "-36.97",
  WEATHER_LON: "174.82",
};

test("defaults the time to 08:30 and reads the coordinates as numbers", () => {
  expect(loadBriefingConfig(env)).toMatchObject({
    BRIEFING_TIME: "08:30",
    WEATHER_LAT: -36.97,
    WEATHER_LON: 174.82,
  });
  expect(
    loadBriefingConfig({ ...env, BRIEFING_TIME: "06:30" }).BRIEFING_TIME,
  ).toBe("06:30");
});

test("rejects a bad time or impossible coordinates", () => {
  for (const bad of [
    { BRIEFING_TIME: "7am" },
    { BRIEFING_TIME: "25:00" },
    { WEATHER_LAT: "91" },
    { WEATHER_LON: "abc" },
  ])
    expect(() => loadBriefingConfig({ ...env, ...bad })).toThrow(/Invalid/);
});

test("errors name the variable and never echo the Telegram values", () => {
  const bad = () =>
    loadBriefingConfig({
      ...env,
      TELEGRAM_BOT_TOKEN: "oops-token",
      TELEGRAM_CHAT_ID: "oops-chat",
    });
  expect(bad).toThrow(/TELEGRAM_BOT_TOKEN[\s\S]*TELEGRAM_CHAT_ID/);
  expect(bad).toThrow(
    expect.not.objectContaining({ message: expect.stringContaining("oops") }),
  );
});
