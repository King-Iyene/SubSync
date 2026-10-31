// Proves no server-side secret reaches the browser. Run after `next build` (npm run verify does).
//  1. Reads the value of every secret-looking variable from .env.local (names are printed, values never are) and searches
//     every file the browser can download (.next/static and public) for that value.
//  2. Fails if any client component reads a non-public environment variable.
//  3. Lists the NEXT_PUBLIC_ variables in use, so each one can be justified.
// Without .env.local (CI) step 1 has no values to look for and says so; steps 2 and 3 still run.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SECRET_NAME = /(SECRET|PASSWORD|TOKEN|PRIVATE|SERVICE_ROLE|ENCRYPTION|API_KEY|_KEY$|SSO)/i;

function envFile() {
  const out = {};
  if (!existsSync(".env.local")) return out;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
function walk(dir, ext) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (!ext || ext.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

const failures = [];
const env = envFile();
const secrets = Object.entries(env).filter(([k, v]) => SECRET_NAME.test(k) && !k.startsWith("NEXT_PUBLIC_") && v.length >= 12);

// 1. built files the browser can fetch
if (!existsSync(".next/static")) failures.push("No build found (.next/static). Run `next build` first.");
const shipped = [...walk(".next/static"), ...walk("public")];
for (const f of shipped) {
  const text = readFileSync(f, "latin1");
  for (const [name, value] of secrets) if (text.includes(value)) failures.push(`The value of ${name} appears in ${f}`);
}
console.log(`bundle: searched ${shipped.length} browser-visible files for ${secrets.length} secret values (names only are ever printed)`);
if (secrets.length === 0) console.log("bundle: no .env.local, so no secret values to search for here");

// 2. client components must not read private environment variables
const publicVars = new Set();
for (const f of walk("src", [".ts", ".tsx"])) {
  const text = readFileSync(f, "utf8");
  const head = text.replace(/^(\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/\s*)*/, "");
  const isClient = /^["']use client["']/.test(head.trimStart());
  for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
    if (m[1].startsWith("NEXT_PUBLIC_")) publicVars.add(m[1]);
    else if (isClient && m[1] !== "NODE_ENV") failures.push(`Client component ${f} reads the private variable ${m[1]}`);
  }
}

// 3. the public variables in use
console.log(`bundle: NEXT_PUBLIC_ variables referenced in code: ${[...publicVars].sort().join(", ") || "none"}`);

if (failures.length) {
  console.error("FAILED:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
console.log("bundle: no server secret in anything the browser can download, and no client component reads a private variable: ok");
