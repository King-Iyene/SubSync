// Starts the app in demo mode on port 3100, runs the API integration checks, then stops the server.
// Usage: node --env-file=.env.local scripts/with-dev-server.mjs
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

// Optional: SHOTS=pipeline,contacts captures those views (full height) into .tmp-shots/ for a visual check.
const shots = (process.env.SHOTS ?? "").split(",").filter(Boolean);
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const PORT = 3100;
const server = spawn("npx", ["next", "dev", "-p", String(PORT)], {
  // A made-up Zoom secret lets the checks sign a pretend Zoom notification; it never leaves this machine.
  env: { ...process.env, DEMO_MODE: "true", ZOOM_WEBHOOK_SECRET_TOKEN: process.env.ZOOM_WEBHOOK_SECRET_TOKEN ?? "demo-zoom-secret-token" },
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
  for (const name of (process.env.CHECKS ?? "check-api,check-connections,check-insights").split(",").filter(Boolean)) {
    const run = spawnSync("node", ["--env-file=.env.local", "--import", "tsx", `scripts/${name}.ts`], { stdio: "inherit", shell: true });
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
