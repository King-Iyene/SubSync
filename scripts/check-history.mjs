// Searches the whole git history for secrets. Prints commit hashes, file paths and pattern names, never the matched text.
//  1. Value search: for every secret-looking variable in .env.local, `git log -S` finds any commit that ever added or
//     removed that exact value.
//  2. Shape search: common secret formats (private keys, provider keys, tokens, database URLs with a password).
// This is not gitleaks. It is a targeted stand-in that needs nothing installed. Usage: node scripts/check-history.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const SECRET_NAME = /(SECRET|PASSWORD|TOKEN|PRIVATE|SERVICE_ROLE|ENCRYPTION|API_KEY|_KEY$|SSO)/i;
const git = (args, max = 512 * 1024 * 1024) => execFileSync("git", args, { encoding: "utf8", maxBuffer: max });

const env = {};
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const secrets = Object.entries(env).filter(([k, v]) => SECRET_NAME.test(k) && v.length >= 12);
const findings = [];

// 1. values
for (const [name, value] of secrets) {
  const hits = git(["log", "--all", "--format=%h", "-S", value]).split("\n").filter(Boolean);
  if (hits.length) findings.push(`value of ${name} was in commit(s) ${hits.join(", ")}`);
}
console.log(`history: searched the whole history for ${secrets.length} secret values from .env.local`);

// 2. shapes
const PATTERNS = {
  "private key block": /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  "AWS access key": /\bAKIA[0-9A-Z]{16}\b/,
  "Stripe live key": /\bsk_live_[0-9A-Za-z]{16,}/,
  "Slack token": /\bxox[baprs]-[0-9A-Za-z-]{10,}/,
  "GitHub token": /\bgh[pousr]_[0-9A-Za-z]{30,}/,
  "database URL with a password": /postgres(?:ql)?:\/\/[^:\s/@]+:[^@\s]{4,}@[^\s]+/,
  "Supabase secret key": /\bsb_secret_[0-9A-Za-z_-]{20,}/,
  "signed JWT": /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/,
  "bearer token literal": /Bearer\s+[A-Za-z0-9._~+/=-]{30,}/,
};
const log = git(["log", "--all", "-p", "--no-color", "--format=commit %h"]);
let commit = "", file = "";
const seen = new Set();
for (const line of log.split("\n")) {
  if (line.startsWith("commit ")) { commit = line.slice(7, 14); continue; }
  if (line.startsWith("diff --git ")) { file = line.split(" b/")[1] ?? ""; continue; }
  if (!line.startsWith("+") || line.startsWith("+++")) continue;
  for (const [name, re] of Object.entries(PATTERNS)) {
    if (re.test(line)) {
      // Reviewed and allowed: a URL built from a variable (${...}) and the test fixtures with fake hosts.
      if (name === "database URL with a password" && (line.includes("${") || /postgres.abcd|db.example./.test(line))) continue;
      const key = `${name}|${commit}|${file}`;
      if (!seen.has(key)) { seen.add(key); findings.push(`${name}: commit ${commit}, file ${file}`); }
    }
  }
}
const commits = git(["rev-list", "--all", "--count"]).trim();
console.log(`history: scanned ${commits} commits for ${Object.keys(PATTERNS).length} secret shapes`);

if (findings.length) {
  console.error("FOUND:\n" + findings.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
console.log("history: nothing found: ok");
