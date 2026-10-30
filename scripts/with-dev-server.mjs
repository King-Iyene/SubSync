// Starts the app in demo mode on port 3100, runs the API integration checks, then stops the server.
// Usage: node --env-file=.env.local scripts/with-dev-server.mjs
import { spawn, spawnSync } from "node:child_process";

const PORT = 3100;
const server = spawn("npx", ["next", "dev", "-p", String(PORT)], {
  env: { ...process.env, DEMO_MODE: "true" },
  shell: true,
  stdio: "ignore",
});

const stop = () => {
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill("SIGTERM");
};

async function waitUp() {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/privacy`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

let code = 1;
try {
  if (!(await waitUp())) throw new Error("Dev server did not start");
  const run = spawnSync("node", ["--env-file=.env.local", "--import", "tsx", "scripts/check-api.ts"], { stdio: "inherit", shell: true });
  code = run.status ?? 1;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
} finally {
  stop();
}
process.exit(code);
