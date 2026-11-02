// Rewrites docs/SCOPES.md from src/lib/scope-groups.ts. Run: node --import tsx scripts/gen-scopes-doc.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderScopesDoc } from "../src/lib/scope-doc.ts";

writeFileSync(join(process.cwd(), "docs", "SCOPES.md"), renderScopesDoc(), "utf8");
console.log("docs/SCOPES.md written");
