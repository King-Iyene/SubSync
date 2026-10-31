import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Local runs read .env.local (database access for the tests that need it). With no database configured, those tests skip.
try { process.loadEnvFile(".env.local"); } catch { /* CI or a fresh checkout: no local settings */ }
// The test process must behave like a development run, whatever the shell says.
delete process.env.APP_MODE;
delete process.env.DEMO_MODE;

// New tests live in tests/unit. The older tests in src/lib/__tests__ keep running on Node's own runner
// (npm test), and `npm run verify` runs both.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node", testTimeout: 30_000 },
});
