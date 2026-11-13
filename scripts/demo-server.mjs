// Starts the PRODUCTION build (fast screens) with the demo login on, for screenshots and the portal video. Run `npm run build` first. See docs/DEMO_SCREENSHOTS.md.
// The demo login is refused whenever NODE_ENV is "production" (src/lib/runtime-guards.ts, so it can never be on in a real deployment), so this launcher sets NODE_ENV=development for
// the server process only; `next start` still serves the optimised build. READ_CACHE=on keeps finished answers for a few minutes (off in demo by default), so a screen opened twice is instant. FLAGS_ALL_ON shows every module that is built, including the ones still off for real installs.
import { spawn } from "node:child_process";

try { process.loadEnvFile(".env.local"); } catch { /* the variables may come from the shell */ }
const port = process.argv[2] || process.env.PORT || "3210";
const env = { ...process.env, NODE_ENV: "development", DEMO_MODE: "true", FLAGS_ALL_ON: "true", ENTITLEMENTS_MODE: "open", DB_POOL_MAX: process.env.DB_POOL_MAX || "16", READ_CACHE: "on", PORT: port };
delete env.APP_MODE; delete env.VERCEL_ENV;
console.log(`Demo server on http://localhost:${port}/app  (sample data only; stop it with Ctrl+C)`);
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port], { env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill());
