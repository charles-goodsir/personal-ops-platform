import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/dist/**", ".claude/**"],
    // `pnpm coverage`: a report to read, not a gate. Entry points show as 0%
    // on purpose, because nothing tests their timers.
    coverage: {
      include: ["packages/*/src/**"],
      exclude: ["**/*.test.ts"],
    },
  },
});
