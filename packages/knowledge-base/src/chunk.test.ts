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

test("cuts an unbroken run mid-word only as a last resort", () => {
  expect(chunkText("x".repeat(25), 10).map((c) => c.content.length)).toEqual([
    10, 10, 5,
  ]);
});

test("splits an oversized paragraph at line breaks first", () => {
  const list = "- first item here\n- second item\n- third one";
  expect(chunkText(list, 35).map((c) => c.content)).toEqual([
    "- first item here\n- second item",
    "- third one",
  ]);
});

test("then at sentence ends, keeping the full stop", () => {
  const text = "One short sentence. Another short one. A third.";
  expect(chunkText(text, 25).map((c) => c.content)).toEqual([
    "One short sentence.",
    "Another short one.",
    "A third.",
  ]);
});

test("then between words, never cutting one in half", () => {
  const text = "alpha beta gamma delta epsilon zeta eta theta";
  const pieces = chunkText(text, 12).map((c) => c.content);
  expect(pieces.join(" ")).toBe(text);
  for (const p of pieces) {
    expect(p.length).toBeLessThanOrEqual(12);
    expect(p).not.toMatch(/^\s|\s$/);
  }
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
