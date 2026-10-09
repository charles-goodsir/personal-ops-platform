import { expect, test } from "vitest";
import { parseNote } from "./extract.js";

const encode = (s: string) => new TextEncoder().encode(s);

// Builds a minimal valid PDF with one page of text per entry.
function makePdf(pages: string[]): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  pages.forEach((text, i) => {
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return encode(pdf);
}

test("markdown: title from H1, chunks by heading", async () => {
  const note = await parseNote(
    "notes/docker.md",
    encode("# Docker\n## Ports\nbind to 127.0.0.1"),
  );
  expect(note?.title).toBe("Docker");
  expect(note?.chunks).toEqual([
    { heading: "Docker > Ports", content: "bind to 127.0.0.1" },
  ]);
});

test("markdown without an H1 falls back to the file name", async () => {
  const note = await parseNote("notes/Some Note.md", encode("just text"));
  expect(note?.title).toBe("Some Note");
});

test("text: paragraphs, no headings", async () => {
  const note = await parseNote("a/b.TXT", encode("one\n\ntwo"));
  expect(note?.title).toBe("b");
  expect(note?.chunks).toEqual([{ heading: null, content: "one\n\ntwo" }]);
});

test("pdf: extracts text from every page", async () => {
  const note = await parseNote(
    "papers/owasp.pdf",
    makePdf(["Injection", "Broken Access Control"]),
  );
  expect(note?.title).toBe("owasp");
  expect(note?.content).toBe("Injection\n\nBroken Access Control");
  expect(note?.chunks).toHaveLength(1);
});

test("unsupported types return null", async () => {
  expect(await parseNote("photo.jpg", encode("x"))).toBeNull();
});
