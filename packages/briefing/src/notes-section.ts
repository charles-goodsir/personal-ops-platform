import type { Db } from "@ops/core";
import { notesChangedSince } from "@ops/knowledge-base";
import type { Section } from "./runner.js";

const DAY = 86_400_000;
const SHOWN = 5;

// Notes whose file changed in the last 24 hours, by title. Titles only: note
// text never goes into the message. Says nothing when no note changed.
export function notesSection(db: Db, now = () => new Date()): Section {
  return {
    name: "Notes",
    async build() {
      const { total, notes } = await notesChangedSince(
        db,
        new Date(now().getTime() - DAY),
        SHOWN,
      );
      if (total === 0) return null;
      const titles = notes.map((n) => n.title).join(", ");
      const more =
        total > notes.length ? ` and ${total - notes.length} more` : "";
      return `Notes\n${total} changed in the last day: ${titles}${more}`;
    },
  };
}
