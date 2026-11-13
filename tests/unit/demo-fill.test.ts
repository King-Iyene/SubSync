import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_BRIEF_NOTE } from "@/lib/api/ai-routes";

// The demo fill (src/lib/demo/fill*.ts) writes made-up rows for the fictional demo company only. These checks are about the rules that keep it that way: it never reaches a CRM or a
// network, every write is scoped to the demo installation id, and the AI sample is labelled as a sample.
const DIR = join(process.cwd(), "src", "lib", "demo");
const files = readdirSync(DIR).filter((f) => /^fill.*\.ts$/.test(f));

describe("the demo fill stays inside the demo", () => {
  it("has the fill files", () => { expect(files.length).toBeGreaterThanOrEqual(6); });

  for (const f of files) {
    const text = readFileSync(join(DIR, f), "utf8");
    it(`${f}: no CRM, no network, no tokens`, () => {
      expect(text).not.toMatch(/from "\.\.\/ghl|from "\.\.\/sync\/engine|locationAccessToken|getCompanyAccessToken|ghlFetch|\bfetch\(/);
      expect(text).not.toMatch(/process\.env\.(SUPABASE_SERVICE|GHL_)/);
    });
    it(`${f}: every statement that writes names the installation`, () => {
      // A statement that inserts, updates or deletes must carry the installation id (as a column, a value or a filter), never run across all tenants.
      const stmts = text.match(/(insert into\s+(public\.)?"?\w+"?|(?<!do )update\s+(public\.)?"?\w+"?\s+set|delete from\s+(public\.)?"?\w+"?)[\s\S]*?(`|"\s*,\s*\[)/g) ?? [];
      for (const s of stmts) {
        // The shift writes back rows it copied aside a moment earlier (the copy is already limited to the demo installation).
        if (/from demo_shift/.test(s)) continue;
        // The wipe removes the demo installation itself, and only one flagged as the demo (checked in its own test below).
        if (/^delete from installations where id = any\(\$\{ids\}::uuid\[\]\) and is_demo/.test(s)) continue;
        // A bulk insert of row objects: each row object must carry the installation id.
        if (/\$\{db\(\w+ as never\)\}/.test(s)) { expect(text).toMatch(/installation_id: inst/); continue; }
        expect(s, `a write without the installation: ${s.slice(0, 80)}`).toMatch(/installation_id|\$1|\$\{inst\}|\binst\b|\$\{installationId\}/);
      }
    });
  }

  it("the AI sample says it is a sample and names no provider call", () => {
    expect(DEMO_BRIEF_NOTE.startsWith("Sample wording")).toBe(true);
    expect(DEMO_BRIEF_NOTE).toMatch(/no AI was called/i);
  });

  it("the wipe only ever touches an installation flagged as the demo", () => {
    const text = readFileSync(join(DIR, "fill-core.ts"), "utf8");
    expect(text).toMatch(/where company_id = \$\{companyId\} and is_demo/);
    expect(text).toMatch(/delete from installations where id = any\(\$\{ids\}::uuid\[\]\) and is_demo/);
  });
});
