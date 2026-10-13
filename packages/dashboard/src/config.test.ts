import { expect, test } from "vitest";
import { loadDashboardConfig, readOnlyUrl } from "./config.js";

const password = "p".repeat(20);

test("defaults to a tunnel-only setup and lists host names in lower case", () => {
  expect(loadDashboardConfig({ DASHBOARD_PASSWORD: password })).toEqual({
    DASHBOARD_HOST: "127.0.0.1",
    DASHBOARD_PORT: 3100,
    DASHBOARD_ALLOWED_HOSTS: ["localhost", "127.0.0.1"],
    DASHBOARD_PASSWORD: password,
  });
  expect(
    loadDashboardConfig({
      DASHBOARD_PASSWORD: password,
      DASHBOARD_ALLOWED_HOSTS: " Localhost , ",
    }).DASHBOARD_ALLOWED_HOSTS,
  ).toEqual(["localhost"]);
});

test("a missing or short password fails, naming the variable and never its value", () => {
  expect(() => loadDashboardConfig({})).toThrow(/DASHBOARD_PASSWORD/);
  const short = () =>
    loadDashboardConfig({ DASHBOARD_PASSWORD: "short-secret" });
  expect(short).toThrow(/at least 20/);
  expect(short).toThrow(
    expect.not.objectContaining({
      message: expect.stringContaining("short-secret"),
    }),
  );
});

test("the read-only URL starts every connection as dashboard_ro and keeps other options", () => {
  const plain = new URL(readOnlyUrl("postgres://u:p@db:5432/ops"));
  expect(plain.searchParams.get("options")).toBe("-c role=dashboard_ro");
  const scoped = new URL(
    readOnlyUrl("postgres://u:p@db:5432/ops?options=-c%20search_path%3Dx"),
  );
  expect(scoped.searchParams.get("options")).toBe(
    "-c search_path=x -c role=dashboard_ro",
  );
});
