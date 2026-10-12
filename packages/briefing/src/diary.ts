export interface DiaryEntry {
  date: string;
  title: string;
  workedOn: string[];
}

const MAX_BULLETS = 8;

// 'text' or "text", with \' \" and \\ undone. Anything else (a template string,
// a concatenation) is not a plain literal, and returns null.
function unquote(raw: string): string | null {
  const m = /^(['"])(.*)\1,?$/.exec(raw.trim());
  return m ? (m[2] ?? "").replace(/\\(['"\\])/g, "$1") : null;
}

// Reads the entries out of my-portfolio's cyberDiaryEntries.ts without running
// it. It relies on Prettier's layout: an entry's own fields sit at four spaces
// and its workedOn bullets at six, so the same names nested deeper (a lab's
// title) are ignored. ponytail: tied to that layout, so if a format change ever
// breaks it, publish a small JSON from my-portfolio and read that instead.
export function parseDiary(source: string): DiaryEntry[] {
  const entries: DiaryEntry[] = [];
  let cur: { date?: string; title?: string; workedOn: string[] } | null = null;
  let inWorked = false;
  let titleNext = false;
  const finish = () => {
    if (cur?.date && cur.title) {
      entries.push({
        date: cur.date,
        title: cur.title,
        workedOn: cur.workedOn,
      });
    }
  };
  for (const line of source.split("\n")) {
    if (titleNext && cur) {
      cur.title = unquote(line) ?? undefined;
      titleNext = false;
      continue;
    }
    if (inWorked && cur) {
      if (/^ {4}\],?$/.test(line)) inWorked = false;
      else {
        const bullet = unquote(line);
        if (bullet !== null) cur.workedOn.push(bullet);
      }
      continue;
    }
    const field = /^ {4}(\w+):\s*(.*)$/.exec(line);
    if (!field) continue;
    const [, key, value = ""] = field;
    if (key === "id") {
      finish();
      cur = { workedOn: [] };
    } else if (!cur) continue;
    else if (key === "date") cur.date = unquote(value) ?? undefined;
    else if (key === "title") {
      if (value === "") titleNext = true;
      else cur.title = unquote(value) ?? undefined;
    } else if (key === "workedOn" && value === "[") inWorked = true;
  }
  finish();
  return entries;
}

// The NZ calendar date before `now`. Taking 24 hours off is safe at any time
// of day the briefing runs, because a one-hour clock change can't cross midnight.
export function yesterdayNz(now: Date): string {
  const prev = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
  }).format(prev);
}

// One message for the day: each entry's title, then its bullets. "Next:" bullets
// are a plan, not work done, so they are left out. Null when there is no entry,
// so a quiet day sends nothing.
export function diarySummary(
  entries: DiaryEntry[],
  day: string,
): string | null {
  const todays = entries.filter((e) => e.date === day);
  if (todays.length === 0) return null;
  const blocks = todays.map((e) => {
    const done = e.workedOn.filter((b) => !/^next:/i.test(b));
    const lines = done.slice(0, MAX_BULLETS).map((b) => `- ${b}`);
    if (done.length > MAX_BULLETS) {
      lines.push(`and ${done.length - MAX_BULLETS} more`);
    }
    return [e.title, ...lines].join("\n");
  });
  return `Yesterday's work\n\n${blocks.join("\n\n")}`;
}

// The public repo, fixed in code: nothing a caller or a message can change.
const DIARY_URL =
  "https://raw.githubusercontent.com/charles-goodsir/my-portfolio/main/src/data/cyberDiaryEntries.ts";
const MAX_BYTES = 2_000_000; // the real file is about 300 KB

export async function fetchDiary(
  opts: { fetchFn?: typeof fetch; timeoutMs?: number } = {},
): Promise<string> {
  const doFetch = opts.fetchFn ?? fetch;
  const res = await doFetch(DIARY_URL, {
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  });
  if (!res.ok) throw new Error(`diary fetch failed: ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error("diary fetch failed: too large");
  return text;
}

// Sends yesterday's message, or nothing on a quiet day. A file with no entries
// at all means the layout changed or the fetch returned the wrong thing, so
// that throws: the heartbeat then stays old and the watchdog alerts, instead of
// every day looking quiet.
export async function sendDiary(opts: {
  send: (text: string) => Promise<void>;
  day: string;
  fetchFn?: typeof fetch;
}): Promise<boolean> {
  const entries = parseDiary(await fetchDiary({ fetchFn: opts.fetchFn }));
  if (entries.length === 0) throw new Error("diary parse found no entries");
  const text = diarySummary(entries, opts.day);
  if (text === null) return false;
  await opts.send(text);
  return true;
}
