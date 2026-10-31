// Starts the app for the browser tests: `next dev` on port 3100 with the demo login switched on (never allowed in
// production; see src/lib/runtime-guards.ts). Reads .env.local for the database. Playwright starts and stops this.
import { spawn } from "node:child_process";

try { process.loadEnvFile(".env.local"); } catch { /* CI supplies the variables itself */ }
const env = { ...process.env, DEMO_MODE: "true", ENTITLEMENTS_MODE: "open", PORT: "3100" };
delete env.APP_MODE;
delete env.FLAGS_ALL_ON; // test with the real default flags

const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", "3100"], { env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill());
