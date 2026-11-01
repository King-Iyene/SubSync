"use client";

import { useState } from "react";
import { plural } from "@/lib/text";
import { useApiClient, useData } from "../session";
import { Badge, Btn, Card, Empty, ErrorBox, ExtLink, fmtInt, fmtMoney, Loading, PageHeader, Sparkline, Stat, Table, Td, Th } from "../ui";

type QualityFigure = { state: "checked"; value: number; of: number } | { state: "not_checked"; reason: string };
type Engagement = {
  working: number; cold: number; noneSeen: number; recent: number; quietAfter: number; quietDays: number; coldChosen: boolean;
  coldLists: Array<{ tag: string; contacts: number; engaged: number; source: "owner" | "name" }>;
};
type SourceSummary = {
  total: number; noSource: number; noSourcePct: number | null;
  kinds: Array<{ kind: string; label: string; contacts: number; won: number; wonValue: number; new30: number }>;
  action: { headline: string; steps: string[] } | null;
};

type Person = { contactId: string; locationId: string; locationName: string | null; name: string; url: string };
type Data = {
  sources: Array<{ source: string; contacts: number; new30: number; won: number; wonValue: number; conversion: number | null }>;
  dnd: { total: number; dnd: number; dndWithPhone: number };
  birthdays: Array<{ contactId: string; name: string; locationName: string | null; days: number; url: string; phone: string | null }>;
  cohorts: Array<{ month: string; leads: number; converted: number; revenue: number; conversionPct: number | null }>;
  lifecycle: { total: number; leads: number; opportunities: number; opportunitiesCounted?: number; customers: number; lost: number };
  engagement?: Engagement;
  canEditCold?: boolean;
  sourceSummary?: SourceSummary;
  leadAging: { over30: number; over60: number; over90: number };
  inactive: { total: number; never: number; silent: number; d30: number; d60: number; d90: number; d180: number };
  growth: { weekly: Array<{ week: string; count: number }>; total12w: number; accounts: Array<{ locationId: string; name: string | null; last30: number; prev30: number; changePct: number | null }> };
  tags: { top: Array<{ tag: string; count: number }>; rare: Array<{ tag: string; count: number }>; variants: Array<{ total: number; variants: Array<{ tag: string; count: number }> }> };
  quality: {
    total: number; badEmail: number; disposable: number; badPhone: number;
    invalidEmails?: QualityFigure; disposableEmails?: QualityFigure; invalidPhones?: QualityFigure; missingEmails?: QualityFigure; missingPhones?: QualityFigure;
  };
  imports: Array<{ account: string; day: string; count: number; noEmailPct: number; noPhonePct: number }>;
  topLeads: Array<Person & { email: string | null; phone: string | null; score: number; reasons: string[]; lastActivityAt: string | null }>;
  vips: Array<Person & { wonValue: number; openValue: number; wonCount: number; idleDays: number | null; needsContact: boolean }>;
  badData: Array<Person & { email: string | null; phone: string | null; emailProblem: string | null }>;
};

const scoreTone = (s: number) => (s >= 70 ? "good" : s >= 40 ? "warn" : "neutral");

function Funnel({ items }: { items: Array<{ label: string; n: number }> }) {
  const max = Math.max(1, ...items.map((i) => i.n));
  return (
    <ul className="space-y-2 text-sm">
      {items.map((i) => (
        <li key={i.label}>
          <div className="flex justify-between"><span>{i.label}</span><span className="tabular-nums text-muted-foreground">{fmtInt(i.n)}</span></div>
          <div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary/70" style={{ width: `${Math.round((i.n / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

// A figure that was checked, or the plain reason it was not (N46): a zero is never shown when the check could not run.
function figure(q: QualityFigure | undefined, fallback: number): { text: string; note: string } {
  if (!q) return { text: fmtInt(fallback), note: "" };
  return q.state === "checked" ? { text: fmtInt(q.value), note: `of ${fmtInt(q.of)} checked` } : { text: "Not checked", note: q.reason };
}

// Which tags are cold lists (N45): bought, scraped or cold-outreach contacts are kept apart from the people you are really working.
function ColdLists({ e, tags, canEdit, onChanged }: { e: Engagement; tags: string[]; canEdit: boolean; onChanged: () => Promise<void> | void }) {
  const api = useApiClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const cold = new Set(e.coldLists.map((c) => c.tag));
  const save = async (next: string[] | null) => {
    setBusy(true);
    setMsg(null);
    try { await api.put("settings", { coldTags: next }); await onChanged(); } catch (err) { setMsg((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card title="Cold lists" action={canEdit && e.coldChosen ? <Btn variant="ghost" disabled={busy} onClick={() => save(null)}>Use the tag names instead</Btn> : undefined}>
      {e.coldLists.length === 0 ? <p className="text-sm text-muted-foreground">No tag is marked as a cold list, so every contact is counted as a working lead.</p> : (
        <ul className="space-y-1.5 text-sm">
          {e.coldLists.map((c) => (
            <li key={c.tag} className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{c.tag} <span className="text-xs font-normal text-muted-foreground">{c.source === "name" ? "(suggested from its name)" : "(you marked it)"}</span></span>
              <span className="tabular-nums text-muted-foreground">{plural(c.contacts, "contact")}, {c.engaged} with a reply, booking or deal seen</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Contacts on a cold list never asked to hear from you, so they are not counted as working leads or as going quiet.</p>
      {canEdit && tags.length > 0 && (
        <fieldset className="mt-3" disabled={busy}>
          <legend className="text-xs font-medium">Mark a tag as a cold list</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {tags.map((t) => (
              <label key={t} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
                <input type="checkbox" checked={cold.has(t)} onChange={(ev) => save(ev.target.checked ? [...cold, t] : [...cold].filter((x) => x !== t))} aria-label={`${t} is a cold list`} />{t}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {msg && <p className="mt-2 text-sm text-red-600" role="alert">{msg}</p>}
    </Card>
  );
}

// `part` shows one piece of the old long page inside the People module (stage F10): "cold" (lifecycle and cold lists), "more" (cohorts, best leads, valuable contacts,
// growth, do not disturb, birthdays) or "sources" (data quality, sources, imports). With no part it is the whole page, as before.
export function LeadsView({ part }: { part?: "cold" | "more" | "sources" } = {}) {
  const { data, error, loading, reload } = useData<Data>("contact-intel");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  if (data.lifecycle.total === 0) return <div><PageHeader title="Leads" subtitle="Who to call, who is going quiet and where your contact data is weak." /><Empty title="No contacts yet" body="Contacts appear here once the first sync finishes." /></div>;

  const show = (p: "cold" | "more" | "sources") => !part || part === p;
  const l = data.lifecycle;
  const q = data.quality;
  const eg = data.engagement;
  const growthTotal = data.growth.total12w;
  const badEmail = figure(q.invalidEmails, q.badEmail);
  const badPhone = figure(q.invalidPhones, q.badPhone);
  const bothChecked = q.invalidEmails?.state !== "not_checked" && q.invalidPhones?.state !== "not_checked";
  const badTotal = (q.invalidEmails?.state === "checked" ? q.invalidEmails.value : q.badEmail) + (q.invalidPhones?.state === "checked" ? q.invalidPhones.value : q.badPhone) + (q.disposableEmails?.state === "checked" ? q.disposableEmails.value : q.disposable);

  return (
    <div className="space-y-6">
      {!part && <PageHeader title="Leads" subtitle="Who to work first, who is going quiet, and where your contact data is weak, across every client account." />}

      {!part && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Contacts" value={fmtInt(l.total)} sub={<>{fmtInt(growthTotal)} added in 12 weeks{eg ? <span className="block">{fmtInt(eg.working)} working leads, {fmtInt(eg.cold)} on cold lists</span> : null}</>} />
        <Stat label="Customers" value={fmtInt(l.customers)} sub="have a won deal" />
        {eg
          ? <Stat label={`Engaged, then quiet ${eg.quietDays}+ days`} value={fmtInt(eg.quietAfter)} tone={eg.quietAfter > 0 ? "warn" : undefined}
              sub={`working leads who wrote, booked or had a deal, and nothing since. ${fmtInt(eg.noneSeen)} had nothing seen at all.`} />
          : <Stat label="Engaged, then quiet" value="Not measured" sub="Not available right now" />}
        <Stat label="Invalid email or phone" value={bothChecked ? fmtInt(badTotal) : "Not checked"} tone={bothChecked && badTotal > 0 ? "warn" : undefined}
          sub={bothChecked ? "will bounce or not connect (a missing value is counted separately)" : (badEmail.note || badPhone.note)} />
      </div>}

      {show("cold") && <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Contact lifecycle">
          <Funnel items={[
            { label: "Leads (no deal yet)", n: l.leads }, { label: "In an open deal (any value)", n: l.opportunities },
            { label: "Customers (won a deal)", n: l.customers }, { label: "Lost or closed out (only lost deals, or deals in a closed-out stage)", n: l.lost },
          ]} />
          <p className="mt-3 text-sm text-muted-foreground">
            {plural(data.leadAging.over60, "lead is", "leads are")} older than 60 days with no deal ({fmtInt(data.leadAging.over30)} older than 30, {fmtInt(data.leadAging.over90)} older than 90). They are going cold.
          </p>
          {l.opportunitiesCounted !== undefined && (
            <p className="mt-2 text-xs text-muted-foreground" data-testid="counted-note">
              The open deals here are every open deal in play, whatever its value. Only {fmtInt(l.opportunitiesCounted)} of these {l.opportunities === 1 ? "contact has" : "contacts have"} a deal with a value and an owner, the kind the dollar figures on Pipeline and Today count.
            </p>
          )}
        </Card>
        {eg && <Card title="Working leads: who has engaged">
          <Funnel items={[
            { label: `Seen in the last ${eg.quietDays} days`, n: eg.recent }, { label: `Engaged, then nothing for ${eg.quietDays}+ days`, n: eg.quietAfter }, { label: "Nothing seen", n: eg.noneSeen },
          ]} />
          <p className="mt-3 text-sm text-muted-foreground">
            &quot;Engaged&quot; means the customer wrote last in a conversation, booked an appointment, or has a deal. It comes from the newest conversations of each account, so &quot;nothing seen&quot; does not mean they never replied. Cold lists are counted separately.
          </p>
        </Card>}
      </div>}

      {eg && show("cold") && <ColdLists e={eg} tags={data.tags.top.map((t) => t.tag)} canEdit={data.canEditCold === true} onChanged={reload} />}

      {show("more") && data.cohorts.length > 0 && (
        <Card title="Lead cohorts (by the month they arrived)">
          <Table head={<tr><Th>Month</Th><Th className="text-right">New contacts</Th><Th className="text-right">Became customers</Th><Th className="text-right">Conversion</Th><Th className="text-right">Revenue won</Th></tr>}>
            {data.cohorts.map((c) => (
              <tr key={c.month}>
                <Td className="font-medium">{c.month}</Td><Td className="text-right tabular-nums">{fmtInt(c.leads)}</Td><Td className="text-right tabular-nums">{fmtInt(c.converted)}</Td>
                <Td className="text-right tabular-nums">{c.conversionPct === null ? "n/a" : c.conversionPct + "%"}</Td><Td className="text-right tabular-nums">{fmtMoney(c.revenue)}</Td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">Newer months have had less time to convert, so compare like with like. Shows whether lead quality is improving.</p>
        </Card>
      )}

      {show("more") && <>
      <Card title="Best leads to work now">
        {data.topLeads.length === 0 ? <Empty title="No active leads yet" /> : (
          <Table head={<tr><Th>Contact</Th><Th>Account</Th><Th>Score</Th><Th>Why</Th><Th>{""}</Th></tr>}>
            {data.topLeads.map((c) => (
              <tr key={`${c.locationId}-${c.contactId}`} className="hover:bg-muted/40">
                <Td className="font-medium">{c.name}<div className="text-xs font-normal text-muted-foreground">{c.email ?? c.phone ?? ""}</div></Td>
                <Td>{c.locationName ?? "Unnamed account"}</Td>
                <Td><Badge tone={scoreTone(c.score)}>{c.score}</Badge></Td>
                <Td className="text-xs text-muted-foreground">{c.reasons.slice(0, 3).join(", ")}</Td>
                <Td><ExtLink href={c.url}>Open</ExtLink></Td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Score (0 to 100) is higher for contacts you can reach, who were active recently, and who have an open deal. Customers are left out.</p>
      </Card>

      <Card title="Your most valuable contacts">
        {data.vips.length === 0 ? <p className="text-sm text-muted-foreground">No won or open deals with a contact attached yet.</p> : (
          <Table head={<tr><Th>Contact</Th><Th>Account</Th><Th className="text-right">Won</Th><Th className="text-right">Open</Th><Th>Last active</Th><Th>{""}</Th></tr>}>
            {data.vips.map((c) => (
              <tr key={`${c.locationId}-${c.contactId}`} className="hover:bg-muted/40">
                <Td className="font-medium">{c.name}</Td>
                <Td>{c.locationName ?? "Unnamed account"}</Td>
                <Td className="text-right tabular-nums">{fmtMoney(c.wonValue)}</Td>
                <Td className="text-right tabular-nums">{fmtMoney(c.openValue)}</Td>
                <Td>{c.idleDays === null ? "Never" : `${c.idleDays}d ago`} {c.needsContact && <Badge tone="warn">Reach out</Badge>}</Td>
                <Td><ExtLink href={c.url}>Open</ExtLink></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="New contacts per week">
          <Sparkline values={data.growth.weekly.map((w) => w.count)} label="New contacts per week" />
          <p className="mt-1 text-xs text-muted-foreground">Last 12 weeks, all client accounts.</p>
        </Card>
        <Card title="Growth by account (30 days vs the 30 before)">
          <ul className="space-y-1.5 text-sm">
            {data.growth.accounts.slice(0, 8).map((a) => (
              <li key={a.locationId} className="flex items-center justify-between gap-3">
                <span className="truncate">{a.name ?? "Unnamed account"}</span>
                <span className="tabular-nums text-muted-foreground">{a.last30} vs {a.prev30}{" "}
                  {a.changePct !== null && <Badge tone={a.changePct >= 0 ? "good" : "warn"}>{a.changePct > 0 ? "+" : ""}{a.changePct}%</Badge>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      </>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {!part && <Card title="Tags">
          <ul className="space-y-1 text-sm">{data.tags.top.map((t) => <li key={t.tag} className="flex justify-between"><span>{t.tag}</span><span className="tabular-nums text-muted-foreground">{fmtInt(t.count)}</span></li>)}</ul>
          {data.tags.variants.length > 0 && (
            <div className="mt-4 rounded-lg bg-amber-500/10 p-3 text-sm">
              <p className="font-medium">Tags that look like duplicates</p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {data.tags.variants.map((v, i) => <li key={i}>{v.variants.map((x) => `${x.tag} (${x.count})`).join(" / ")}</li>)}
              </ul>
            </div>
          )}
          {data.tags.rare.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Barely used: {data.tags.rare.map((t) => t.tag).join(", ")}</p>}
        </Card>}
        {show("sources") && <Card title="Contact data quality">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3" data-testid="quality">
            {([["Invalid emails", q.invalidEmails, q.badEmail], ["Disposable emails", q.disposableEmails, q.disposable], ["Invalid phones", q.invalidPhones, q.badPhone]] as const).map(([label, fig, fallback]) => {
              const f = figure(fig, fallback);
              return <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className={`font-semibold tabular-nums ${fig?.state === "not_checked" ? "text-base text-muted-foreground" : "text-lg"}`}>{f.text}</dd><dd className="text-xs text-muted-foreground">{f.note}</dd></div>;
            })}
            {([["Missing emails", q.missingEmails], ["Missing phones", q.missingPhones]] as const).map(([label, fig]) => {
              const f = figure(fig, 0);
              return <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className={`font-semibold tabular-nums ${fig?.state === "not_checked" ? "text-base text-muted-foreground" : "text-lg"}`}>{f.text}</dd><dd className="text-xs text-muted-foreground">{f.note}</dd></div>;
            })}
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">Invalid means a value was typed and cannot work. Missing means there is nothing to check. They are different problems.</p>
          {data.badData.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              {data.badData.slice(0, 6).map((c) => (
                <li key={`${c.locationId}-${c.contactId}`} className="flex justify-between gap-2"><span className="truncate">{c.name} ({c.locationName}): {c.emailProblem ? c.email : c.phone}</span><ExtLink href={c.url}>Fix</ExtLink></li>
              ))}
            </ul>
          )}
        </Card>}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {show("sources") && <Card title="Where leads come from" className="lg:col-span-2">
          {data.sourceSummary?.action && (
            <div className="mb-4 rounded-lg bg-amber-500/10 p-3 text-sm" data-testid="source-action">
              <p className="font-medium">{data.sourceSummary.action.headline}</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">{data.sourceSummary.action.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            </div>
          )}
          {data.sourceSummary && data.sourceSummary.kinds.length > 0 && (
            <ul className="mb-3 space-y-1 text-sm" aria-label="Sources by kind">
              {data.sourceSummary.kinds.map((k) => <li key={k.kind} className="flex justify-between gap-3"><span>{k.label}</span><span className="tabular-nums text-muted-foreground">{fmtInt(k.contacts)}</span></li>)}
            </ul>
          )}
          {data.sources.length === 0 ? <p className="text-sm text-muted-foreground">No source information yet.</p> : (
            <Table head={<tr><Th>Source</Th><Th className="text-right">Contacts</Th><Th className="text-right">New (30d)</Th><Th className="text-right">Became customers</Th><Th className="text-right">Revenue won</Th></tr>}>
              {data.sources.map((s) => (
                <tr key={s.source}><Td>{s.source}</Td><Td className="text-right tabular-nums">{fmtInt(s.contacts)}</Td><Td className="text-right tabular-nums">{fmtInt(s.new30)}</Td>
                  <Td className="text-right tabular-nums">{fmtInt(s.won)}{s.conversion !== null ? ` (${Math.round(s.conversion * 100)}%)` : ""}</Td><Td className="text-right tabular-nums">${fmtInt(s.wonValue)}</Td></tr>
              ))}
            </Table>
          )}
          <p className="mt-2 text-xs text-muted-foreground">The best source is the one that brings customers, not just contacts. Percentages need at least 10 contacts.</p>
        </Card>}
        {show("more") && <div className="space-y-4">
          <Card title="Do not disturb">
            <p className="text-2xl font-semibold tabular-nums">{fmtInt(data.dnd.dnd)}</p>
            <p className="text-sm text-muted-foreground">{data.dnd.dnd === 1 ? "contact asked" : "contacts asked"} not to be contacted ({data.dnd.total ? Math.round((data.dnd.dnd / data.dnd.total) * 100) : 0}%). {data.dnd.dnd === 1 ? "That person is" : "They are"} left out of every call list.</p>
          </Card>
          <Card title="Birthdays in the next 30 days">
            {data.birthdays.length === 0 ? <p className="text-sm text-muted-foreground">None coming up, or no birth dates on file.</p> : (
              <ul className="space-y-1 text-sm">{data.birthdays.slice(0, 8).map((b) => <li key={b.contactId} className="flex justify-between gap-2"><a href={b.url} target="_blank" rel="noreferrer" className="underline">{b.name}</a><span className="text-muted-foreground">{b.days === 0 ? "today" : `in ${b.days}d`}</span></li>)}</ul>
            )}
          </Card>
        </div>}
      </div>

      {show("sources") && data.imports.length > 0 && (
        <Card title="Large imports">
          <Table head={<tr><Th>Account</Th><Th>Day</Th><Th className="text-right">Contacts added</Th><Th className="text-right">No email</Th><Th className="text-right">No phone</Th></tr>}>
            {data.imports.map((i) => (
              <tr key={`${i.account}-${i.day}`}><Td>{i.account}</Td><Td>{i.day}</Td><Td className="text-right tabular-nums">{fmtInt(i.count)}</Td><Td className="text-right tabular-nums">{i.noEmailPct}%</Td><Td className="text-right tabular-nums">{i.noPhonePct}%</Td></tr>
            ))}
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">Days when 50 or more contacts were added at once, which is usually an import. High gaps mean the import file was incomplete.</p>
        </Card>
      )}
    </div>
  );
}
