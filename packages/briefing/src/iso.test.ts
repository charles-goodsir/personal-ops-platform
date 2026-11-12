import { expect, test, vi } from "vitest";
import { ISO_ENTRIES } from "./iso-content.js";
import { formatEntry, pickEntry, sendIso, type IsoEntry } from "./iso.js";

const entry = (id: string, over: Partial<IsoEntry> = {}): IsoEntry => ({
  id,
  title: `Title ${id}`,
  area: "Annex A, Technological",
  asks: "Do the thing.",
  stack: "My stack does it.",
  question: "How would you show it?",
  ...over,
});
const three = [entry("A.1"), entry("A.2"), entry("A.3")];

test("one entry a day in order, then it repeats; before the start or with none, nothing", () => {
  const at = (day: string) => pickEntry(three, "2026-11-13", day)?.id;
  expect(at("2026-11-13")).toBe("A.1");
  expect(at("2026-11-14")).toBe("A.2");
  expect(at("2026-11-15")).toBe("A.3");
  expect(at("2026-11-16")).toBe("A.1");
  expect(pickEntry(three, "2026-11-13", "2026-11-12")).toBeNull();
  expect(pickEntry([], "2026-11-13", "2026-11-13")).toBeNull();
});

test("the message names the control, what it asks, my stack and a question", () => {
  expect(formatEntry(entry("A.8.8"))).toBe(
    [
      "ISO 27001: A.8.8 Title A.8.8",
      "Annex A, Technological",
      "",
      "What it asks: Do the thing.",
      "In my stack: My stack does it.",
      "Think about: How would you show it?",
    ].join("\n"),
  );
  expect(formatEntry(entry("A.1", { asks: "x".repeat(5000) })).length).toBe(
    3900,
  );
});

test("sends today's entry, and sends nothing before the start date", async () => {
  const send = vi.fn(async () => {});
  const now = new Date("2026-11-14T02:00:00Z"); // 15:00 NZ on the 14th
  expect(
    await sendIso({ send, entries: three, start: "2026-11-13", now }),
  ).toBe(true);
  expect(send).toHaveBeenCalledWith(expect.stringContaining("A.2"));
  send.mockClear();
  expect(
    await sendIso({ send, entries: three, start: "2026-12-01", now }),
  ).toBe(false);
  expect(send).not.toHaveBeenCalled();
});

test("a failed send throws, so the heartbeat stays old", async () => {
  const send = vi.fn(async () => {
    throw new Error("telegram down");
  });
  await expect(
    sendIso({
      send,
      entries: three,
      start: "2026-11-13",
      now: new Date("2026-11-13T02:00:00Z"),
    }),
  ).rejects.toThrow("telegram down");
});

test("the real content has unique ids and every field filled in", () => {
  const ids = ISO_ENTRIES.map((e) => e.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const e of ISO_ENTRIES)
    for (const v of Object.values(e))
      expect(v.trim().length).toBeGreaterThan(0);
});
