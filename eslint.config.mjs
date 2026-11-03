import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-*/**", // extra build folders used to run test servers side by side
    ".claude/**", // agent worktrees
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Scratch files and test output: never real code.
    ".tmp-*",
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
