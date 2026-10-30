"use client";

import { useData } from "../session";
import { Badge, Card, Empty, ErrorBox, ExtLink, fmtInt, fmtMoney, Loading, PageHeader, Sparkline, Stat, Table, Td, Th } from "../ui";

type Person = { contactId: string; locationId: string; locationName: string | null; name: string; url: string };
type Data = {
  lifecycle: { total: number; leads: number; opportunities: number; customers: number; lost: number };
  leadAging: { over30: number; over60: number; over90: number };
  inactive: { total: number; never: number; silent: number; d30: number; d60: number; d90: number; d180: number };
  growth: { weekly: Array<{ week: string; count: number }>; accounts: Array<{ locationId: string; name: string | null; last30: number; prev30: number; changePct: number | null }> };
  tags: { top: Array<{ tag: string; count: number }>; rare: Array<{ tag: string; count: number }>; variants: Array<{ total: number; variants: Array<{ tag: string; count: number }> }> };
  quality: { total: number; badEmail: number; disposable: number; badPhone: number };
  imports: Array<{ account: string; day: string; count: number; noEmailPct: number; noPhonePct: number }>;
  overlap: { total: number; people: Array<{ email: string; accounts: number; names: string[] }> };
  topLeads: Array<Person & { email: string | null; phone: string | null; score: number; reasons: string[]; lastActivityAt: string | null }>;
  vips: Array<Person & { wonValue: number; openValue: number; wonCount: number; idleDays: number | null; needsContact: boolean }>;
  badData: Array<Person & { email: string | null; phone: string | null; emailProblem: string | null }>;
};

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "0%");
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

export function LeadsView() {
  const { data, error, loading, reload } = useData<Data>("contact-intel");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  if (data.lifecycle.total === 0) return <div><PageHeader title="Leads" subtitle="Who to call, who is going quiet and where your contact data is weak." /><Empty title="No contacts yet" body="Contacts appear here once the first sync finishes." /></div>;

  const l = data.lifecycle;
  const q = data.quality;
  const growthTotal = data.growth.weekly.reduce((s, w) => s + w.count, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Leads" subtitle="Who to work first, who is going quiet, and where your contact data is weak, across every client account." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Contacts" value={fmtInt(l.total)} sub={`${fmtInt(growthTotal)} added in 12 weeks`} />
        <Stat label="Customers" value={fmtInt(l.customers)} sub="have a won deal" />
        <Stat label="Quiet over 90 days" value={fmtInt(data.inactive.d90)} tone={data.inactive.d90 > 0 ? "warn" : undefined} sub={pct(data.inactive.d90, data.inactive.total) + " of contacts"} />
        <Stat label="Bad email or phone" value={fmtInt(q.badEmail + q.badPhone + q.disposable)} tone={q.badEmail + q.badPhone > 0 ? "warn" : undefined} sub="will bounce or not connect" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Contact lifecycle">
          <Funnel items={[
            { label: "Leads (no deal yet)", n: l.leads }, { label: "In an open deal", n: l.opportunities },
            { label: "Customers (won a deal)", n: l.customers }, { label: "Lost (only lost deals)", n: l.lost },
          ]} />
          <p className="mt-3 text-sm text-muted-foreground">
            {fmtInt(data.leadAging.over60)} leads are older than 60 days with no deal ({fmtInt(data.leadAging.over30)} older than 30, {fmtInt(data.leadAging.over90)} older than 90). They are going cold.
          </p>
        </Card>
        <Card title="Going quiet">
          <Funnel items={[
            { label: "No activity for 30+ days", n: data.inactive.d30 }, { label: "60+ days", n: data.inactive.d60 },
            { label: "90+ days", n: data.inactive.d90 }, { label: "180+ days", n: data.inactive.d180 },
          ]} />
          <p className="mt-3 text-sm text-muted-foreground">
            {fmtInt(data.inactive.never)} contacts never engaged at all; {fmtInt(data.inactive.silent)} engaged once, then went silent for 90+ days. Consider a re-engagement campaign or archiving.
          </p>
        </Card>
      </div>

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

      <div className="grid gap-4 lg:grid-cols-2">
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Tags">
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
        </Card>
        <Card title="Contact data quality">
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-muted-foreground">Invalid emails</dt><dd className="text-lg font-semibold tabular-nums">{fmtInt(q.badEmail)}</dd></div>
            <div><dt className="text-muted-foreground">Disposable emails</dt><dd className="text-lg font-semibold tabular-nums">{fmtInt(q.disposable)}</dd></div>
            <div><dt className="text-muted-foreground">Invalid phones</dt><dd className="text-lg font-semibold tabular-nums">{fmtInt(q.badPhone)}</dd></div>
          </dl>
          {data.badData.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              {data.badData.slice(0, 6).map((c) => (
                <li key={`${c.locationId}-${c.contactId}`} className="flex justify-between gap-2"><span className="truncate">{c.name} ({c.locationName}): {c.emailProblem ? c.email : c.phone}</span><ExtLink href={c.url}>Fix</ExtLink></li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {data.imports.length > 0 && (
        <Card title="Large imports">
          <Table head={<tr><Th>Account</Th><Th>Day</Th><Th className="text-right">Contacts added</Th><Th className="text-right">No email</Th><Th className="text-right">No phone</Th></tr>}>
            {data.imports.map((i) => (
              <tr key={`${i.account}-${i.day}`}><Td>{i.account}</Td><Td>{i.day}</Td><Td className="text-right tabular-nums">{fmtInt(i.count)}</Td><Td className="text-right tabular-nums">{i.noEmailPct}%</Td><Td className="text-right tabular-nums">{i.noPhonePct}%</Td></tr>
            ))}
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">Days when 50 or more contacts were added at once, which is usually an import. High gaps mean the import file was incomplete.</p>
        </Card>
      )}

      {data.overlap.total > 0 && (
        <Card title={`Same person in several client accounts (${fmtInt(data.overlap.total)})`}>
          <ul className="space-y-1 text-sm">
            {data.overlap.people.map((p) => <li key={p.email}><span className="font-medium">{p.email}</span> <span className="text-muted-foreground">is in {p.accounts} accounts: {p.names.join(", ")}</span></li>)}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Check that two of your clients are not working the same lead.</p>
        </Card>
      )}
    </div>
  );
}
