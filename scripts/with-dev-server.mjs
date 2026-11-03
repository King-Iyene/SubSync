// Starts the app in demo mode on port 3100, runs the API integration checks, then stops the server.
// Usage: node --env-file=.env.local scripts/with-dev-server.mjs
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

// Optional: SHOTS=pipeline,contacts captures those views (full height) into .tmp-shots/ for a visual check.
const shots = (process.env.SHOTS ?? "").split(",").filter(Boolean);
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

// TEST_PORT and TEST_DIST_DIR let this run beside the browser-test server (which holds port 3100 and the .next folder).
const PORT = Number(process.env.TEST_PORT ?? 3100);
const DIST = process.env.TEST_DIST_DIR;

// A server already listening on the port (for example one left behind by a browser-test run) would answer the checks instead of the one this script
// starts, with different settings (no FLAGS_ALL_ON, no Zoom test secret), and the checks would fail or, worse, pass against the wrong server.
// Refuse to start rather than test the wrong thing.
try {
  await fetch(`http://localhost:${PORT}/privacy`, { signal: AbortSignal.timeout(3000) });
  console.error(`Port ${PORT} already has a server on it. Stop it first (look for a node process running "next dev -p ${PORT}"), then run this again.`);
  process.exit(2);
} catch { /* nothing answered: the port is free */ }

// A made-up secret for the cron and diagnostics addresses, so the checks can open them; it never leaves this machine. (The real one is a Vercel setting.)
const CRON_SECRET = process.env.CRON_SECRET ?? "local-test-cron-secret";

const server = spawn("npx", ["next", "dev", "-p", String(PORT)], {
  // A made-up Zoom secret lets the checks sign a pretend Zoom notification; it never leaves this machine.
  env: { ...process.env, ...(DIST ? { NEXT_DIST_DIR: DIST } : {}), DEMO_MODE: "true", CRON_SECRET, FLAGS_ALL_ON: process.env.FLAGS_ALL_ON ?? "true", ENTITLEMENTS_MODE: process.env.ENTITLEMENTS_MODE ?? "open", ZOOM_WEBHOOK_SECRET_TOKEN: process.env.ZOOM_WEBHOOK_SECRET_TOKEN ?? "demo-zoom-secret-token" },
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
  // CHECKS=check-connections runs just one script while iterating; the default runs them all.
  for (const name of (process.env.CHECKS ?? "check-api,check-connections,check-insights,check-tenancy,check-sync,check-flags,check-metrics,check-filter,check-stage-rules,check-audit,check-speed,check-roadmap,check-f8").split(",").filter(Boolean)) {
    const run = spawnSync("node", ["--env-file=.env.local", "--import", "tsx", `scripts/${name}.ts`], { stdio: "inherit", shell: true, env: { ...process.env, CRON_SECRET, BASE_URL: `http://localhost:${PORT}` } });
    code = run.status ?? 1;
    if (code !== 0) break;
  }
  // HOLD=1 keeps the demo server running for manual browsing (stop it with Ctrl+C or by ending the task).
  if (process.env.HOLD) await new Promise(() => {});
  const dir = `${process.cwd()}/.tmp-shots`;
  if (shots.length) mkdirSync(dir, { recursive: true });
  // "view" or "view@business" / "view@client" to open the demo as a single business or a client.
  for (const spec of shots) {
    const [hash, as] = spec.split("@");
    const r = spawnSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1600,2600", "--virtual-time-budget=40000",
      `--screenshot=${dir}/${spec.replace(/[^a-z0-9=@-]/gi, "_").replace("@", "-as-")}.png`, `http://localhost:${PORT}/app${as ? "?as=" + as : ""}#${hash}`], { encoding: "utf8" });
    if (r.error || r.status) console.error("screenshot failed", hash, r.error?.message ?? r.status, (r.stderr ?? "").slice(-200));
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
} finally {
  stop();
}
process.exit(code);
