// Checks the People numbers against raw rows on the largest real installation (read-only: selects only). Prints each check with both numbers.
//   node --env-file=.env.local --import tsx scripts/check-people.ts
import { contactOverview } from "../src/lib/analytics/contact-queries";
import { coldTagsFor, goingCold, peopleOptions, searchPeople, tagDetail } from "../src/lib/analytics/people-list-queries";
import { leadSources } from "../src/lib/analytics/people-queries";
import { closeDb, sql } from "../src/lib/db";

let bad = 0;
function check(label: string, a: number, b: number) {
  const ok = a === b;
  if (!ok) bad++;
  console.log(`${ok ? "OK  " : "DIFF"} ${label}: ${a.toLocaleString("en-US")} vs ${b.toLocaleString("en-US")}`);
}

async function main() {
  const [big] = await sql()`select c.installation_id id from cached_contacts c join installations i on i.id = c.installation_id where i.is_demo is not true and i.uninstalled_at is null group by 1 order by count(*) desc limit 1`;
  const id = big.id as string;
  const raw = async (where: ReturnType<ReturnType<typeof sql>>) => (await sql()`select count(*)::int n from cached_contacts c join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored where c.installation_id = ${id} and ${where}`)[0].n as number;
  const db = sql();
  const opts = await peopleOptions(id, null);
  const cold = await coldTagsFor(id, null, null);
  const all = await searchPeople(id, null, {}, 1, cold);
  check("everyone (list total vs raw count)", all.total, await raw(db`true`));
  const t = opts.tags[0];
  check(`tag '${t.tag}' (list total vs raw @>)`, (await searchPeople(id, null, { tags: [t.tag] }, 1, cold)).total, await raw(db`c.tags @> ${[t.tag]}::text[]`));
  check("no owner", (await searchPeople(id, null, { owner: "none" }, 1, cold)).total, await raw(db`nullif(c.assigned_to, '') is null`));
  check("has phone and not do-not-disturb", (await searchPeople(id, null, { hasPhone: true, hideDnd: true }, 1, cold)).total, await raw(db`nullif(c.phone, '') is not null and not c.dnd`));
  check("quiet 90+ days", (await searchPeople(id, null, { quietDays: 90 }, 1, cold)).total, await raw(db`coalesce(c.last_activity_at, c.date_added) < now() - interval '90 days'`));
  check("tag count in options vs raw", t.count, await raw(db`c.tags @> ${[t.tag]}::text[]`));
  // The Unknown source bar on the Leads figure is the same people as the "no source" filter.
  const sources = await leadSources(id, null);
  const unknown = sources.find((s) => s.source === "Unknown");
  if (unknown) check("source Unknown (chart count vs list total)", unknown.contacts, (await searchPeople(id, null, { source: "none" }, 1, cold)).total);
  const top = sources.find((s) => s.source !== "Unknown");
  if (top) check(`source '${top.source}' (chart count vs list total)`, top.contacts, (await searchPeople(id, null, { source: top.source }, 1, cold)).total);
  // Going cold: the three groups plus the cold-list contacts are every contact; and the chart's figure (the Leads engagement count) equals the list.
  const [q, r, n] = await Promise.all((["quiet", "recent", "none"] as const).map((b) => goingCold(id, null, b, cold, 1)));
  const coldCount = (await searchPeople(id, null, { cold: "cold" }, 1, cold)).total;
  check("going cold groups + cold lists = everyone", q.total + r.total + n.total + coldCount, all.total);
  const overview = await contactOverview(id, null, null);
  check("engaged then quiet (Leads figure vs list)", overview.engagement.quietAfter, q.total);
  check("seen recently (Leads figure vs list)", overview.engagement.recent, r.total);
  check("nothing seen (Leads figure vs list)", overview.engagement.noneSeen, n.total);
  const d = await tagDetail(id, null, t.tag, "2026-08-03", "2026-11-01");
  console.log(`tag history: ${d.tagged} tagged in the window, ${d.removedInWindow} removed, watching since ${d.since ?? "nothing recorded yet"}`);
  console.log(bad === 0 ? "All checks agree." : `${bad} check(s) differ.`);
  await closeDb();
  process.exit(bad === 0 ? 0 : 1);
}
void main();
