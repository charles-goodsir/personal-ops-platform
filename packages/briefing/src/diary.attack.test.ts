import { expect, test, vi } from "vitest";
import { diarySummary, parseDiary, sendDiary } from "./diary.js";

// Batch C (C3): the diary file is text from the internet. A hostile or broken file
// must give a bounded result quickly, never a hang or a huge message.
const timed = <T>(fn: () => T) => {
  const t = Date.now();
  const out = fn();
  return { out, ms: Date.now() - t };
};
const entry = (date: string, title: string, bullets: string[]) =>
  [
    "  {",
    `    id: '${title}',`,
    `    date: '${date}',`,
    `    title: '${title}',`,
    "    workedOn: [",
    ...bullets.map((b) => `      '${b}',`),
    "    ],",
    "  },",
  ].join("\n");

test("C3: a 2 MB line is parsed in well under a second", () => {
  for (const file of [
    `    title: '${"a".repeat(2_000_000)}',`,
    `    title: '${"\\".repeat(2_000_000)}',`,
    `    title: ${"'".repeat(2_000_000)}`,
    `    title:${" ".repeat(2_000_000)}x`,
    `    workedOn: [\n${"      '".repeat(100_000)}`,
  ]) {
    const { ms } = timed(() => parseDiary(file));
    expect(ms).toBeLessThan(1000);
  }
});

test("C3: 200,000 short lines are parsed in under a second", () => {
  const file = Array.from(
    { length: 200_000 },
    (_, i) => `      'bullet ${i}',`,
  ).join("\n");
  expect(timed(() => parseDiary(file)).ms).toBeLessThan(1000);
});

test("C3: a workedOn list that never closes is bounded by the file, not the entries", () => {
  const file = `${entry("2026-10-12", "x", [])}\n    id: 'y',\n    date: '2026-10-12',\n    title: 'z',\n    workedOn: [\n${Array.from({ length: 50_000 }, () => "      'b',").join("\n")}`;
  const out = parseDiary(file);
  expect(out.length).toBeLessThanOrEqual(2);
});

test("C3: 50,000 entries for one day make a summary that is cut to fit one message", () => {
  const entries = Array.from({ length: 50_000 }, (_, i) =>
    entry("2026-10-12", `title ${i}`, ["did a thing"]),
  ).join("\n");
  const { out, ms } = timed(() =>
    diarySummary(parseDiary(entries), "2026-10-12"),
  );
  expect(ms).toBeLessThan(3000);
  expect(out?.length ?? 0).toBeLessThanOrEqual(4000);
  expect(out).toMatch(/and \d+ more entries$/);
});

test("C3: control and direction-changing characters never reach the message", () => {
  const file = entry("2026-10-12", "t\u0007itle‮", ["do\u0000ne⁦ it"]);
  const text = diarySummary(parseDiary(file), "2026-10-12") ?? "";
  // Newlines separate the lines of the message and are fine; nothing else is.
  expect(text.replace(/\n/g, "")).not.toMatch(
    /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u,
  );
});

test("C3: an HTML page, an empty file and a binary file are errors, not quiet days", async () => {
  const send = vi.fn(async () => {});
  for (const body of [
    "<html>rate limited</html>",
    "",
    Buffer.from([0, 1, 2, 255, 254]).toString("latin1"),
  ])
    await expect(
      sendDiary({
        send,
        day: "2026-10-12",
        fetchFn: async () => new Response(body),
      }),
    ).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});
