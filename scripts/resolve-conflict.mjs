// Resolves one conflict block in a file with a replacement text read from a file.
//   node scripts/resolve-conflict.mjs <file> <replacement file>
// The replacement is the exact text that should stand in place of the whole <<<<<<< ... >>>>>>> block (the first one in the file).
import { readFileSync, writeFileSync } from "node:fs";

const [file, repl] = process.argv.slice(2);
const crlf = readFileSync(file, "utf8").includes("\r\n");
const src = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const a = src.indexOf("<<<<<<< ");
const e = src.indexOf(">>>>>>> ", a);
if (a < 0 || e < 0) throw new Error("no conflict block");
const end = src.indexOf("\n", e) + 1;
let out = src.slice(0, a) + readFileSync(repl, "utf8").replace(/\r\n/g, "\n").replace(/\n?$/, "\n") + src.slice(end);
if (crlf) out = out.replace(/\n/g, "\r\n");
writeFileSync(file, out);
console.log(`resolved one block in ${file}; blocks left: ${(out.match(/<<<<<<< /g) || []).length}`);
