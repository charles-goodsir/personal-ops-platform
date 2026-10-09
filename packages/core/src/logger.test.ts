import { Writable } from "node:stream";
import { expect, test } from "vitest";
import { createLogger } from "./logger.js";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk));
      done();
    },
  });
  return { lines, stream };
}

test("redacts secrets at top level and one level down", () => {
  const { lines, stream } = capture();
  const log = createLogger({ LOG_LEVEL: "info" }, stream);
  log.info(
    {
      password: "hunter2",
      req: { authorization: "Bearer abc" },
      user: "charles",
    },
    "hi",
  );
  const out = lines.join("");
  expect(out).not.toContain("hunter2");
  expect(out).not.toContain("Bearer abc");
  expect(out).toContain("charles");
});
