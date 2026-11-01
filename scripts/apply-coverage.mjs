// Runs the `node scripts/notes-coverage.mjs set ...` lines that a stage agent left in its feature file (docs/features/<ID>.md).
//   node scripts/apply-coverage.mjs F4
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const id = process.argv[2];
if (!id) throw new Error("usage: node scripts/apply-coverage.mjs <stage id>");
const text = readFileSync(`docs/features/${id}.md`, "utf8").replace(/\r\n/g, "\n");
const lines = text.split("\n").filter((l) => l.startsWith("node scripts/notes-coverage.mjs set "));
let ok = 0;
for (const line of lines) {
  const r = spawnSync("bash", ["-c", line], { encoding: "utf8" });
  if (r.status === 0) ok++;
  else console.error("FAILED:", line.slice(0, 90), (r.stderr || r.stdout || "").trim().slice(0, 160));
}
console.log(`${id}: ${ok} of ${lines.length} coverage lines applied`);
