import { expect, test } from "vitest";
import { chunkMarkdown, chunkText, markdownTitle } from "./chunk.js";

test("tracks the heading path and resets it at a higher level", () => {
  const md = [
    "intro",
    "# Setup",
    "a",
    "## Docker",
    "b",
    "### Compose",
    "c",
    "## Postgres",
    "d",
  ].join("\n");
  expect(chunkMarkdown(md)).toEqual([
    { heading: null, content: "intro" },
    { heading: "Setup", content: "a" },
    { heading: "Setup > Docker", content: "b" },
    { heading: "Setup > Docker > Compose", content: "c" },
    { heading: "Setup > Postgres", content: "d" },
  ]);
});

test("ignores headings inside code fences", () => {
  const md = "# Bash\n```\n# not a heading\necho hi\n```";
  expect(chunkMarkdown(md)).toEqual([
    { heading: "Bash", content: "```\n# not a heading\necho hi\n```" },
  ]);
});

test("skips empty sections and strips frontmatter", () => {
  const md = "---\ntags: [x]\n---\n# Empty\n\n# Full\nbody";
  expect(chunkMarkdown(md)).toEqual([{ heading: "Full", content: "body" }]);
});

test("packs paragraphs up to the limit, then starts a new chunk", () => {
  const text = "aaaa\n\nbbbb\n\ncccc";
  expect(chunkText(text, 10)).toEqual([
    { heading: null, content: "aaaa\n\nbbbb" },
    { heading: null, content: "cccc" },
  ]);
});

test("splits a paragraph longer than the limit", () => {
  expect(chunkText("x".repeat(25), 10).map((c) => c.content.length)).toEqual([
    10, 10, 5,
  ]);
});

test("no chunk is longer than the limit", () => {
  const text = Array.from({ length: 50 }, (_, i) => "w".repeat(i * 7)).join(
    "\n\n",
  );
  for (const c of chunkText(text, 100)) {
    expect(c.content.length).toBeLessThanOrEqual(100);
  }
});

test("title is the first H1, ignoring frontmatter", () => {
  expect(markdownTitle("---\ntitle: x\n---\n## Sub\n# Real Title #")).toBe(
    "Real Title",
  );
  expect(markdownTitle("no heading")).toBeNull();
});
