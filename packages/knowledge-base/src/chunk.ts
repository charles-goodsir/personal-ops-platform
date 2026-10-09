export type Chunk = { heading: string | null; content: string };

// ~1500 chars is roughly 350 tokens: small enough that a search hit points at
// one idea, big enough to keep a paragraph's context. nomic accepts far more.
export const MAX_CHARS = 1500;

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
      for (let i = 0; i < para.length; i += maxChars) {
        chunks.push({ heading, content: para.slice(i, i + maxChars) });
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
