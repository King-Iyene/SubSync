import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// New tests live in tests/unit. The older tests in src/lib/__tests__ keep running on Node's own runner
// (npm test), and `npm run verify` runs both.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
});
