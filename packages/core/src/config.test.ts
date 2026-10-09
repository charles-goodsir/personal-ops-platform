import { expect, test } from "vitest";
import { loadConfig } from "./config.js";

const valid = { DATABASE_URL: "postgres://u:p@localhost:5432/db" };

test("applies defaults", () => {
  const config = loadConfig(valid);
  expect(config.NODE_ENV).toBe("development");
  expect(config.LOG_LEVEL).toBe("info");
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
