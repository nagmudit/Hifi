import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{apps,packages}/*/src/**/*.test.ts"],
    environment: "node",
    // Model APIs are never called from tests. See packages/*/README.md.
    env: { NODE_ENV: "test" },
  },
});
