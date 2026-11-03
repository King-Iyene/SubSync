// docs/SCOPES.md is produced from src/lib/scope-groups.ts, so the document that justifies each permission can never drift from the list the app asks for.
// `node --env-file=.env.local --import tsx scripts/gen-scopes-doc.ts` rewrites it; src/lib/__tests__/scope-experience.test.ts fails when the file is stale.
import { NO_PERMISSION_GROUPS, NOT_REQUESTED, SCOPE_GROUPS } from "./scope-groups.ts";

export function renderScopesDoc(): string {
  const all = SCOPE_GROUPS.flatMap((g) => g.scopes);
  const required = all.filter((s) => s.required).length;
  const out: string[] = [];
  out.push("# Permissions SubSync asks for, and why");
  out.push("");
  out.push("This file is generated from `src/lib/scope-groups.ts` (run `scripts/gen-scopes-doc.ts`). A test fails when it is stale, when a permission the app asks for is missing from it, or when it lists one the app does not ask for. Do not edit it by hand.");
  out.push("");
  out.push(`SubSync asks for ${all.length} permissions: ${required} required and ${all.length - required} optional. Fewer permissions is a trust advantage, and every permission added later makes every installed company approve again, so each one below has a reason. An optional permission can be declined: the feature that needs it then says "Needs permission: reconnect" and everything else keeps working.`);
  out.push("");
  out.push("Wording rule: the screen says one of three things. **Needs permission: reconnect** (the app asked and this install declined, or the app has not asked yet), **Not available from the platform yet** (the platform refuses even with the permission, or has no such data), or it simply shows the data. See `docs/CAPABILITIES.md` for which data point is which.");
  for (const g of SCOPE_GROUPS) {
    out.push("");
    out.push(`## ${g.title}`);
    out.push("");
    out.push(g.summary);
    out.push("");
    out.push("| Permission | Kind | Required | Why we ask |");
    out.push("| --- | --- | --- | --- |");
    for (const s of g.scopes) out.push(`| \`${s.scope}\` | ${s.kind === "read" ? "read" : "change"} | ${s.required ? "required" : "optional"} | ${s.why} |`);
  }
  for (const g of NO_PERMISSION_GROUPS) {
    out.push("");
    out.push(`## ${g.title}`);
    out.push("");
    out.push(g.text);
  }
  out.push("");
  out.push("## Not requested, and why");
  out.push("");
  out.push("| Permission | Why it is not asked for |");
  out.push("| --- | --- |");
  for (const n of NOT_REQUESTED) out.push(`| \`${n.scope}\` | ${n.why} |`);
  out.push("");
  out.push("## Rules for every change permission");
  out.push("");
  out.push("Show exactly what will change, require a typed confirmation, keep the old values so it can be undone, write an audit entry, and refuse when the permission was declined. Nothing in SubSync changes your data without a preview, except the note added to a matched contact when a meeting summary arrives (switchable in Settings).");
  out.push("");
  return out.join("\n");
}
