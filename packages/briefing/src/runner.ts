import type { Logger } from "@ops/core";

// One part of the briefing. Returns text, or null when there's nothing to say
// today (so a quiet section leaves no empty heading).
export type Section = {
  name: string;
  build: () => Promise<string | null>;
};

const SECTION_TIMEOUT_MS = 15_000;

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });

// "Wed 14 Oct", in New Zealand.
function dateLine(now: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-NZ", {
      timeZone: "Pacific/Auckland",
      weekday: "short",
      day: "numeric",
      month: "short",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.day} ${parts.month}`;
}

// Builds every section at once. A section that throws or times out is logged
// and shows as "<name>: unavailable", with the error kept out of the message.
// ponytail: a timed-out build keeps running in the background; add an
// AbortSignal to sections if one ever holds a connection open.
export async function runBriefing(
  sections: Section[],
  opts: { logger: Logger; now?: Date; timeoutMs?: number },
): Promise<string> {
  const results = await Promise.all(
    sections.map(async (s) => {
      try {
        const text = await withTimeout(
          Promise.resolve().then(() => s.build()),
          opts.timeoutMs ?? SECTION_TIMEOUT_MS,
        );
        return { ok: true as const, text };
      } catch (err) {
        opts.logger.warn({ err, section: s.name }, "briefing section failed");
        return { ok: false as const, text: `${s.name}: unavailable` };
      }
    }),
  );
  const header = `Briefing for ${dateLine(opts.now ?? new Date())}`;
  if (results.length > 0 && results.every((r) => !r.ok))
    return `${header}\n\nEvery section failed, check the logs.`;
  const blocks = results.flatMap((r) => (r.text ? [r.text] : []));
  return blocks.length
    ? `${header}\n\n${blocks.join("\n\n")}`
    : `${header}\n\nNothing to report.`;
}
