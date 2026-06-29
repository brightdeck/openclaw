import { defineConfig } from "vitest/config";

// Isolated config for the release smoke suite. There is intentionally no
// `vitest.config.*` for the default run (it uses vitest's built-in defaults,
// whose include matches only `*.test.`/`*.spec.`), so naming smoke files
// `*.smoke.ts` keeps them out of `pnpm test`. This config opts them back in
// for `pnpm test:smoke` only.
export default defineConfig({
  test: {
    include: ["src/__tests__/smoke/**/*.smoke.ts"],
    environment: "node",
  },
});
