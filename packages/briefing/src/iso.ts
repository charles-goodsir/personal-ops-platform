import { nzDate } from "@ops/finance";

const DAY = 86_400_000;
// Telegram's limit is 4096; this leaves room.
const MAX_MESSAGE = 3900;

// One thing to learn: a clause of the management system (4 to 10) or an Annex A
// control. The wording is my own, not the standard's.
export type IsoEntry = {
  id: string; // "6.1.2" for a clause, "A.8.8" for a control
  title: string;
  area: string; // "Clause 6, Planning" or "Annex A, Technological"
  asks: string; // what it requires, in plain words
  stack: string; // where it shows up in my own projects
  question: string; // an interview-style question to think about
};

// Whole days from `start` to `today`, "YYYY-MM-DD" both, in a fixed order that
// repeats. A missed day is skipped, not made up.
export function pickEntry(
  entries: IsoEntry[],
  start: string,
  today: string,
): IsoEntry | null {
  if (entries.length === 0) return null;
  const days = Math.floor(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY,
  );
  if (days < 0) return null;
  return entries[days % entries.length] ?? null;
}

export function formatEntry(e: IsoEntry): string {
  const text = [
    `ISO 27001: ${e.id} ${e.title}`,
    e.area,
    "",
    `What it asks: ${e.asks}`,
    `In my stack: ${e.stack}`,
    `Think about: ${e.question}`,
  ].join("\n");
  return text.length > MAX_MESSAGE
    ? `${text.slice(0, MAX_MESSAGE - 1)}…`
    : text;
}

// Sends today's entry. False when there is nothing to send (before the start
// date, or no content yet). A failed send throws, so the heartbeat stays old and
// the watchdog alerts instead of the day looking quiet.
export async function sendIso(opts: {
  send: (text: string) => Promise<void>;
  entries: IsoEntry[];
  start: string;
  now?: Date;
}): Promise<boolean> {
  const entry = pickEntry(
    opts.entries,
    opts.start,
    nzDate(opts.now ?? new Date()),
  );
  if (entry === null) return false;
  await opts.send(formatEntry(entry));
  return true;
}
