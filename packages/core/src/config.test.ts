import { expect, test } from "vitest";
import { loadConfig } from "./config.js";

const valid = { DATABASE_URL: "postgres://u:p@localhost:5432/db" };

test("applies defaults", () => {
  const config = loadConfig(valid);
  expect(config.NODE_ENV).toBe("development");
  expect(config.LOG_LEVEL).toBe("info");
  expect(config.OLLAMA_URL).toBe("http://localhost:11434");
  expect(config.EMBED_MODEL).toBe("nomic-embed-text");
  expect(config.NOTES_DIR).toBe("./notes");
});

test("rejects missing DATABASE_URL", () => {
  expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
});

test("rejects a non-postgres URL", () => {
  expect(() => loadConfig({ DATABASE_URL: "http://localhost/db" })).toThrow(
    /DATABASE_URL/,
  );
});

test("error message never contains the bad value", () => {
  expect(() => loadConfig({ ...valid, LOG_LEVEL: "s3cret-value" })).toThrow(
    expect.not.objectContaining({
      message: expect.stringContaining("s3cret-value"),
    }),
  );
});

test("the healthcheck url is optional, empty counts as unset, and must be https", () => {
  expect(loadConfig(valid).HEALTHCHECK_PING_URL).toBeUndefined();
  expect(
    loadConfig({ ...valid, HEALTHCHECK_PING_URL: "" }).HEALTHCHECK_PING_URL,
  ).toBeUndefined();
  const url = "https://hc-ping.com/abc";
  expect(
    loadConfig({ ...valid, HEALTHCHECK_PING_URL: url }).HEALTHCHECK_PING_URL,
  ).toBe(url);
  expect(() =>
    loadConfig({ ...valid, HEALTHCHECK_PING_URL: "http://hc-ping.com/abc" }),
  ).toThrow(/HEALTHCHECK_PING_URL/);
});
