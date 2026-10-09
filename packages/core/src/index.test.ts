import { expect, test } from "vitest";
import { name } from "./index.js";

test("core package loads", () => {
  expect(name).toBe("core");
});
