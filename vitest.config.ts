import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Lets tests under tests/ import source modules as "@/core/..." instead of
      // long "../../src/core/..." relative paths. Mirrors the tsconfig paths
      // entry so type checking and test resolution agree.
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    // The tool runs in Node; there is no DOM to emulate.
    environment: "node",

    // All tests live under the top-level tests/ directory: tests/unit holds the
    // fast pure-unit tier and tests/integration holds the slower Tree-sitter
    // grammar tests.
    include: ["tests/**/*.test.ts"],

    // Integration tests load real .wasm grammars and call Parser.init(), which
    // is noticeably slower than the pure-unit tier. The default per-test timeout
    // is raised so the first grammar load on a cold cache does not flake.
    testTimeout: 20000,

    coverage: {
      provider: "v8",
      // Mirror the reporters the previous Jest setup produced.
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "coverage",
      // Measure coverage of the source only. Tests now live outside src, so the
      // exclusions just drop declaration files.
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
    },
  },
});
