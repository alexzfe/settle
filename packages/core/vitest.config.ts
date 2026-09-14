import { defineConfig } from "vitest/config";

// tsc also compiles the tests into dist/; run only the sources.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
