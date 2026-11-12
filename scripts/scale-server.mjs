// Starts ONE dev server against the throwaway scale database (scripts/scale.env) and keeps it running. Local use; CI uses scripts/with-dev-server.mjs.
// Usage: node scripts/scale-server.mjs [port]      (default 3191; WEBPACK=1 when node_modules is a junction, e.g. in a git worktree)
import { spawn } from "node:child_process";

const port = process.argv[2] ?? "3191";
for (const f of [".env.local", "scripts/scale.env"]) process.loadEnvFile(f);
const host = new URL(process.env.DATABASE_URL ?? "http://x").hostname;
if (!["localhost", "127.0.0.1"].includes(host)) { console.error("DATABASE_URL is not local; refusing to start."); process.exit(2); }
const args = ["node_modules/next/dist/bin/next", "dev", ...(process.env.WEBPACK ? ["--webpack"] : []), "-p", port];
const child = spawn(process.execPath, args, { stdio: "inherit", env: { ...process.env, NEXT_DIST_DIR: ".next-scale", DEMO_MODE: "true", FLAGS_ALL_ON: "true", ENTITLEMENTS_MODE: "open", CRON_SECRET: "local-test-cron-secret", NEXT_TELEMETRY_DISABLED: "1" } });
child.on("exit", (c) => process.exit(c ?? 0));
