import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  diarySummary,
  parseDiary,
  yesterdayNz,
  type DiaryEntry,
} from "./diary.js";

// The top of the real cyberDiaryEntries.ts: three entries, one with a title on
// its own line and bullets in double quotes.
const real = readFileSync(
  new URL("./fixtures/diary-sample.txt", import.meta.url),
  "utf8",
);

test("reads the real file's entries: titles on their own line, quotes, apostrophes", () => {
  const entries = parseDiary(real);
  expect(entries.map((e) => e.date)).toEqual([
    "2026-10-12",
    "2026-10-12",
    "2026-10-10",
  ]);
  expect(entries[0]?.title).toBe(
    "Hardening the mini PC before it holds bank data, and a scan that said the host was down",
  );
  expect(entries[0]?.workedOn).toContain(
    "Confirmed Ubuntu's security origin in the unattended-upgrades log",
  );
  expect(entries[1]?.workedOn).toHaveLength(4);
});

test("ignores the same field names nested deeper, such as a lab's title", () => {
  const source = [
    "  {",
    "    id: 'a',",
    "    date: '2026-01-02',",
    "    title: 'Real title',",
    "    workedOn: [",
    "      'one',",
    "    ],",
    "    labs: [",
    "      {",
    "        title: 'Lab title',",
    "        date: '1999-01-01',",
    "      },",
    "    ],",
    "  },",
  ].join("\n");
  expect(parseDiary(source)).toEqual([
    { date: "2026-01-02", title: "Real title", workedOn: ["one"] },
  ]);
});

test("a day with two entries lists both, and drops the Next: plan", () => {
  const text = diarySummary(parseDiary(real), "2026-10-12") ?? "";
  expect(text.startsWith("Yesterday's work\n\n")).toBe(true);
  expect(text).toContain(
    "Deployed Phase 3 to the mini PC with nightly backups",
  );
  expect(text).toContain("Wrote the disk encryption decision into the README");
  expect(text).not.toMatch(/Next:/);
  expect(text).not.toContain("knowledge base"); // the 10 Oct entry
});

test("a day with no entry gives null, so nothing is sent", () => {
  expect(diarySummary(parseDiary(real), "2026-10-11")).toBeNull();
  expect(diarySummary([], "2026-10-12")).toBeNull();
});

test("a long day is cut to eight bullets and says how many it left out", () => {
  const entry: DiaryEntry = {
    date: "2026-10-12",
    title: "Big day",
    workedOn: Array.from({ length: 11 }, (_, i) => `step ${i + 1}`),
  };
  const text = diarySummary([entry], "2026-10-12") ?? "";
  expect(text).toContain("- step 8");
  expect(text).not.toContain("step 9");
  expect(text).toContain("and 3 more");
});

test("yesterday is the NZ date, including the morning daylight saving starts", () => {
  expect(yesterdayNz(new Date("2026-10-12T19:05:00Z"))).toBe("2026-10-12"); // 07:05 on the 13th
  expect(yesterdayNz(new Date("2026-09-26T18:05:00Z"))).toBe("2026-09-26"); // 07:05 NZDT on the 27th
  expect(yesterdayNz(new Date("2026-04-04T19:05:00Z"))).toBe("2026-04-04"); // 07:05 NZST on the 5th
});
