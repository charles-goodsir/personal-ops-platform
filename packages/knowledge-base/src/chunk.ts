export type Chunk = { heading: string | null; content: string };

// ~1500 chars is roughly 350 tokens: small enough that a search hit points at
// one idea, big enough to keep a paragraph's context. nomic accepts far more.
export const MAX_CHARS = 1500;

// Bump when chunking output changes, so ingest re-indexes unchanged files.
export const CHUNKER_VERSION = 2;

// Splits text longer than maxChars at the gentlest boundary available: lines,
// then sentences, then words. Only a single unbroken run longer than maxChars
// is cut mid-word.
function splitLong(
  text: string,
  maxChars: number,
  seps = ["\n", ". ", " "],
): string[] {
  if (text.length <= maxChars) return [text];
  const [sep, ...rest] = seps;
  if (sep === undefined) {
    const pieces: string[] = [];
    for (let i = 0; i < text.length; i += maxChars)
      pieces.push(text.slice(i, i + maxChars));
    return pieces;
  }
  // Keep the separator on the piece before it, so sentences keep their full stop.
  const parts = text
    .split(sep)
    .map((p, i, all) => (i < all.length - 1 ? p + sep : p));
  const pieces: string[] = [];
  let current = "";
  for (const part of parts) {
    if (current && (current + part).trimEnd().length > maxChars) {
      pieces.push(current.trimEnd());
      current = "";
    }
    if (part.trimEnd().length > maxChars) {
      pieces.push(...splitLong(part.trimEnd(), maxChars, rest));
      continue;
    }
    current += part;
  }
  if (current.trim()) pieces.push(current.trimEnd());
  return pieces;
}

// Packs paragraphs into chunks of at most maxChars, splitting any paragraph
// that is longer than that on its own.
// ponytail: no overlap between chunks, add it if answers miss context at edges.
function pack(text: string, heading: string | null, maxChars: number): Chunk[] {
  const chunks: Chunk[] = [];
  let current = "";
  const flush = () => {
    if (current) chunks.push({ heading, content: current });
    current = "";
  };
  for (const para of text.split(/\n\s*\n/).map((p) => p.trim())) {
    if (!para) continue;
    if (current && current.length + 2 + para.length > maxChars) flush();
    if (para.length > maxChars) {
      flush();
      for (const piece of splitLong(para, maxChars)) {
        chunks.push({ heading, content: piece });
      }
      continue;
    }
    current = current ? `${current}\n\n${para}` : para;
  }
  flush();
  return chunks;
}

export function chunkText(text: string, maxChars = MAX_CHARS): Chunk[] {
  return pack(text, null, maxChars);
}

// Splits on ATX headings (# to ######), ignoring any inside fenced code
// blocks. Each chunk's heading is the path to it, e.g. "Setup > Docker".
export function chunkMarkdown(text: string, maxChars = MAX_CHARS): Chunk[] {
  const chunks: Chunk[] = [];
  const path: string[] = [];
  let section: string[] = [];
  let inFence = false;
  const flush = () => {
    const heading = path.filter(Boolean).join(" > ") || null;
    chunks.push(...pack(section.join("\n"), heading, maxChars));
    section = [];
  };
  for (const line of stripFrontmatter(text).split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const match = inFence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match?.[1] && match[2]) {
      flush();
      const level = match[1].length;
      path.length = level - 1;
      path[level - 1] = match[2];
      continue;
    }
    section.push(line);
  }
  flush();
  return chunks;
}

// First H1, used as the note's title.
export function markdownTitle(text: string): string | null {
  return /^#\s+(.+?)\s*#*\s*$/m.exec(stripFrontmatter(text))?.[1] ?? null;
}

// Obsidian-style YAML frontmatter is metadata, not content.
function stripFrontmatter(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}
