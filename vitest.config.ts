import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
    globals: true,
    projects: [
      {
        test: {
          environment: "node",
          include: ["tests-ts/unit/**/*.test.ts"],
          name: "unit",
        },
      },
      {
        test: {
          environment: "node",
          fileParallelism: false,
          include: ["tests-ts/integration/**/*.test.ts"],
          name: "integration",
        },
      },
    ],
  },
});
