import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve workspace packages to their TypeScript sources, as `tsx --conditions` does in dev.
  ssr: {
    resolve: {
      conditions: ["@settle/source", "node", "import", "default"],
    },
  },
  test: {
    // tsc also compiles the tests into dist/; run only the sources.
    include: ["src/**/*.test.ts"],
  },
});
