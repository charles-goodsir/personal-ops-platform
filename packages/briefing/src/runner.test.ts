import type { Logger } from "@ops/core";
import { expect, test, vi } from "vitest";
import { runBriefing, type Section } from "./runner.js";

// 14 October 2026 07:00 NZDT.
const now = new Date("2026-10-13T18:00:00Z");
const ok = (name: string, text: string | null): Section => ({
  name,
  build: async () => text,
});
const logger = () => ({ warn: vi.fn() });
const run = (sections: Section[], log = logger(), timeoutMs = 50) =>
  runBriefing(sections, {
    logger: log as unknown as Logger,
    now,
    timeoutMs,
  });

test("joins the sections in order under a dated header", async () => {
  expect(
    await run([ok("finance", "Spent $40"), ok("weather", "Showers, 17C")]),
  ).toBe("Briefing for Wed 14 Oct\n\nSpent $40\n\nShowers, 17C");
});

test("a throwing section is skipped, the rest still send, the error stays out", async () => {
  const log = logger();
  const text = await run(
    [
      ok("finance", "Spent $40"),
      {
        name: "weather",
        build: async () => {
          throw new Error("secret-key=abc failed");
        },
      },
      ok("notes", "2 notes changed"),
    ],
    log,
  );
  expect(text).toBe(
    "Briefing for Wed 14 Oct\n\nSpent $40\n\nweather: unavailable\n\n2 notes changed",
  );
  expect(text).not.toContain("secret-key");
  expect(log.warn).toHaveBeenCalledWith(
    expect.objectContaining({ section: "weather" }),
    "briefing section failed",
  );
});

test("a section that throws before returning a promise is caught too", async () => {
  const text = await run([
    ok("finance", "Spent $40"),
    {
      name: "notes",
      build: () => {
        throw new Error("sync boom");
      },
    },
  ]);
  expect(text).toContain("notes: unavailable");
  expect(text).toContain("Spent $40");
});

test("a section that never answers times out and is skipped", async () => {
  const text = await run([
    ok("finance", "Spent $40"),
    { name: "weather", build: () => new Promise<string>(() => {}) },
  ]);
  expect(text).toBe(
    "Briefing for Wed 14 Oct\n\nSpent $40\n\nweather: unavailable",
  );
});

test("a section with nothing to say leaves no trace", async () => {
  expect(await run([ok("finance", "Spent $40"), ok("notes", null)])).toBe(
    "Briefing for Wed 14 Oct\n\nSpent $40",
  );
});

test("every section failing says so, and no sections or all-quiet say nothing to report", async () => {
  const boom: Section = {
    name: "a",
    build: async () => {
      throw new Error("x");
    },
  };
  expect(await run([boom, { ...boom, name: "b" }])).toBe(
    "Briefing for Wed 14 Oct\n\nEvery section failed, check the logs.",
  );
  expect(await run([ok("notes", null)])).toBe(
    "Briefing for Wed 14 Oct\n\nNothing to report.",
  );
  expect(await run([])).toBe("Briefing for Wed 14 Oct\n\nNothing to report.");
});
