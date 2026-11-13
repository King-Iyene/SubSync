"use client";

import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import type { AccountRow, GapId, Totals } from "@/lib/workflows/outcomes";
import { money } from "@/lib/workflows/outcomes";
import { EmptyState, InlineAlert, Section, SkeletonCards } from "../ds";
import { useApiClient, useData } from "../session";
import { Btn, ErrorBox } from "../ui";

// The Gaps and Library tabs of the Workflows page (docs/features/WORKFLOWS.md, second pass). Gaps shows outcomes, not workflow internals: people who fell through, per client
// account, with the automation that normally prevents it. Every count opens the exact people with an Open button. Real data by default; sample data only behind ?wffx.

type GapMeta = { id: GapId; short: string; automation: string; template: string | null };
type Outcomes = {
  available: boolean; now: number; totals: Totals; total: number; rows: AccountRow[]; next: string | null; gaps: GapMeta[]; dollars: string | null; formula: string; today: { line: string; count: number } | null;
  trend: Array<{ day: string; people: number; value: number }>; permissions: { list: boolean; write: boolean }; can: { library: boolean; bulk: boolean };
};
type Person = { contactId: string; at: number; name: string | null; phone: string | null; email: string | null; dollars: number; url: string };
type People = { gap: string; total: number; title: string; rows: Person[]; next: string | null };

const sample = (): Outcomes => {
  const z = { no_touch: 0, no_textback: 0, noshow_open: 0, no_reminder: 0 };
  const mk = (locationId: string, name: string, p: [number, number, number, number], v: number, level: AccountRow["level"]): AccountRow => ({
    locationId, name, level, known: true, people: p.reduce((a, b) => a + b, 0), value: v,
    counts: { newLeads: 40, noTouch: p[0], missedCalls: 20, noTextback: p[1], noshows: 8, noshowOpen: p[2], upcoming: 12, noReminder: p[3], atRiskValue: v, value: { ...z } },
    gaps: (["no_touch", "no_textback", "noshow_open", "no_reminder"] as GapId[]).map((id, i) => ({ id, count: p[i], base: 20, value: Math.round(v / 4), wf: level === "critical" ? "missing" : "present", state: p[i] >= 3 ? (level === "critical" ? "open_missing" : "open_present") : p[i] > 0 ? "watching" : "ok", line: `${p[i]} people`, why: "", next: "" })),
  });
  const rows = [mk("s1", "Sample: Bright Smiles Dental", [14, 6, 0, 4], 18400, "critical"), mk("s2", "Sample: Peak Roofing", [0, 0, 5, 0], 9200, "warning"), mk("s3", "Sample: Glow Med Spa", [1, 0, 0, 0], 0, "ok")];
  return { available: true, now: Date.now(), totals: { accounts: 3, attention: 2, people: 30, value: 27600, missingAutomation: 3, byGap: [{ id: "no_touch", people: 15, accounts: 2, value: 12000 }, { id: "no_textback", people: 6, accounts: 1, value: 4000 }, { id: "noshow_open", people: 5, accounts: 1, value: 9200 }, { id: "no_reminder", people: 4, accounts: 1, value: 2400 }] },
    total: 3, rows, next: null, gaps: [{ id: "no_touch", short: "New leads nobody answered", automation: "New lead follow up", template: "speed_breach_task" }, { id: "no_textback", short: "Missed calls with no text back", automation: "Missed call text back", template: null }, { id: "noshow_open", short: "No-shows nobody followed up", automation: "No show follow up", template: "noshow_task" }, { id: "no_reminder", short: "Bookings with no message", automation: "Appointment reminders", template: null }],
    dollars: "$27.6k of open deals belong to these people. This is deal value on file, not money already lost.", formula: "Sample figures.", today: { count: 2, line: "2 client accounts have a lead-handling gap. Most common: new leads nobody answered, 15 people ($27.6k of open deals)." }, trend: [],
    permissions: { list: true, write: true }, can: { library: false, bulk: false } };
};

function PeopleList({ locationId, gap, onClose }: { locationId: string; gap: GapId; onClose: () => void }) {
  const api = useApiClient();
  const first = useData<People>(`workflows/gap-people?locationId=${encodeURIComponent(locationId)}&gap=${gap}`);
  const [added, setAdded] = useState<{ rows: Person[]; next: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = [...(first.data?.rows ?? []), ...(added?.rows ?? [])];
  const next = added ? added.next : first.data?.next ?? null;
  const total = first.data?.total ?? null;
  const err = first.error ? "This list could not be loaded. Try again." : null;
  const more = async () => {
    if (!next) return;
    setBusy(true);
    try { const r = await api.get<People>(`workflows/gap-people?locationId=${encodeURIComponent(locationId)}&gap=${gap}&cursor=${next}`); setAdded({ rows: [...(added?.rows ?? []), ...r.rows], next: r.next }); } finally { setBusy(false); }
  };
  return (
    <div className="mt-2 rounded-lg border bg-muted/30 p-3" data-testid="wf-gap-people">
      <div className="mb-2 flex items-center justify-between text-sm"><span className="font-medium">{total === null ? "Loading..." : `${total} ${total === 1 ? "person" : "people"}`}</span><button type="button" onClick={onClose} className="min-h-9 text-primary hover:underline">Close</button></div>
      {err ? <p className="text-sm text-destructive">{err}</p> : null}
      <ul className="divide-y">
        {rows.map((p) => (
          <li key={p.contactId} className="flex items-center justify-between gap-3 py-2 text-sm" data-testid="wf-gap-person">
            <span className="min-w-0"><span className="block truncate font-medium">{p.name ?? "Unnamed contact"}</span><span className="block truncate text-xs text-muted-foreground">{[p.phone, p.email].filter(Boolean).join(" · ") || "No phone or email on file"}{p.dollars > 0 ? ` · ${money(p.dollars)} open deal` : ""}</span></span>
            <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border px-3 text-primary hover:bg-muted">Open <ExternalLink className="size-3.5" aria-hidden /></a>
          </li>
        ))}
      </ul>
      {next ? <div className="mt-2"><Btn onClick={() => void more()} disabled={busy}>{busy ? "Loading..." : "Show more"}</Btn></div> : null}
    </div>
  );
}

const LEVEL_WORDS: Record<AccountRow["level"], string> = { critical: "Needs you", warning: "Check", info: "Watching", ok: "All clear" };
const LEVEL_CLASS: Record<AccountRow["level"], string> = { critical: "bg-destructive/10 text-destructive", warning: "bg-warning/15 text-warning-foreground", info: "bg-muted text-muted-foreground", ok: "bg-success/10 text-success" };

export function GapsTab({ q, onLibrary }: { q: string; onLibrary: () => void }) {
  const api = useApiClient();
  const fx = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("wffx");
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState<"all" | "attention" | "ok">("all");
  const [gap, setGap] = useState<GapId | "all">("all");
  // Extra pages belong to the filter they were loaded for; a new filter starts again from the first page.
  const [extra, setExtra] = useState<{ key: string; rows: AccountRow[]; next: string | null } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [how, setHow] = useState(false);
  const base = `workflows/outcomes${q ? `${q}&` : "?"}level=${level}&gap=${gap}&q=${encodeURIComponent(search)}`;
  const { data: live, error, loading, reload } = useData<Outcomes>(fx ? null : base);
  const data = fx ? sample() : live;
  const mine = extra && extra.key === base ? extra : null;
  const rows = useMemo(() => [...(data?.rows ?? []), ...(mine?.rows ?? [])], [data, mine]);
  const cursor = mine ? mine.next : data?.next ?? null;
  const loadMore = async () => { if (!cursor) return; const r = await api.get<Outcomes>(`${base}&cursor=${cursor}`); setExtra({ key: base, rows: [...(mine?.rows ?? []), ...r.rows], next: r.next }); };

  if (!fx && loading && !data) return <SkeletonCards cards={3} label="Counting what slipped through..." />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  if (!data.available) return <InlineAlert tone="info" title="Needs the latest database update">Ask the person who manages SubSync to apply the newest update. Until then this tab stays empty.</InlineAlert>;
  const t = data.totals;
  const meta = (id: GapId) => data.gaps.find((g) => g.id === id) as GapMeta;
  return (
    <div data-testid="wf-gaps">
      {fx ? <InlineAlert tone="info" className="mb-4">Sample data. Nothing here is from your accounts.</InlineAlert> : null}
      {data.today ? <InlineAlert tone="warning" title="What to do today" className="mb-4"><span data-testid="wf-today-line">{data.today.line}</span></InlineAlert> : null}
      {!data.permissions.list ? <InlineAlert tone="info" title="Needs permission: reconnect" className="mb-4">Reconnect to let SubSync read your workflows, so it can tell which automation is missing. The people counted below are still real.</InlineAlert> : null}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="wf-gap-tiles">
        {t.byGap.map((g) => (
          <button key={g.id} type="button" onClick={() => setGap(gap === g.id ? "all" : g.id)} aria-pressed={gap === g.id} className={`min-h-20 rounded-xl border p-3 text-left hover:bg-muted ${gap === g.id ? "border-primary" : ""}`}>
            <span className="block text-2xl font-semibold tabular-nums">{g.people}</span>
            <span className="block text-sm">{meta(g.id).short}</span>
            <span className="block text-xs text-muted-foreground">{g.accounts} client account{g.accounts === 1 ? "" : "s"}{g.value > 0 ? ` · ${money(g.value)}` : ""}</span>
          </button>
        ))}
      </div>
      {data.dollars ? <p className="mb-1 text-sm" data-testid="wf-dollars">{data.dollars} <span className="text-muted-foreground">(estimate)</span></p> : <p className="mb-1 text-sm text-muted-foreground">No open deal value is tied to these people.</p>}
      <button type="button" onClick={() => setHow(!how)} className="mb-4 min-h-9 text-sm text-primary hover:underline" aria-expanded={how}>How is this worked out?</button>
      {how ? <p className="mb-4 rounded-lg border bg-muted/30 p-3 text-sm">{data.formula}</p> : null}

      <Section title={`Client accounts (${data.total})`} hint="Worst first. A gap opens at three people or more.">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a client account" aria-label="Find a client account" className="min-h-10 w-full rounded-md border bg-background px-3 text-sm sm:w-64" />
          {(["all", "attention", "ok"] as const).map((l) => <button key={l} type="button" onClick={() => setLevel(l)} aria-pressed={level === l} className={`min-h-10 rounded-md border px-3 text-sm ${level === l ? "border-primary bg-primary/10" : ""}`}>{l === "all" ? "All" : l === "attention" ? "Needs attention" : "All clear"}</button>)}
          {gap !== "all" ? <button type="button" onClick={() => setGap("all")} className="min-h-10 rounded-md border px-3 text-sm">{meta(gap).short} x</button> : null}
        </div>
        {rows.length === 0 ? <EmptyState compact title="Nothing to show" body={level === "all" && !search && gap === "all" ? "No client accounts yet, or nothing has been read from them." : "No client account matches this choice."} /> : (
          <ul className="space-y-3" data-testid="wf-gap-rows">
            {rows.map((r) => (
              <li key={r.locationId} className="rounded-xl border p-3" data-testid="wf-gap-row">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{r.name}</span><span className={`rounded-full px-2 py-0.5 text-xs ${LEVEL_CLASS[r.level]}`}>{LEVEL_WORDS[r.level]}{r.value > 0 ? ` · ${money(r.value)}` : ""}</span></div>
                <ul className="mt-2 space-y-2">
                  {r.gaps.filter((g) => g.count > 0).map((g) => (
                    <li key={g.id} className="text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>{g.line}</span>
                        <button type="button" onClick={() => setOpen(open === `${r.locationId}:${g.id}` ? null : `${r.locationId}:${g.id}`)} disabled={fx} className="min-h-9 rounded-md border px-3 text-primary hover:bg-muted disabled:opacity-50">{g.count} {g.count === 1 ? "person" : "people"}</button>
                      </div>
                      {g.why ? <p className="text-xs text-muted-foreground">{g.why} {g.next}</p> : null}
                      {open === `${r.locationId}:${g.id}` ? <PeopleList locationId={r.locationId} gap={g.id} onClose={() => setOpen(null)} /> : null}
                    </li>
                  ))}
                  {r.people === 0 ? <li className="text-sm text-muted-foreground">Nothing fell through.</li> : null}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {cursor ? <div className="mt-3"><Btn onClick={() => void loadMore()}>Show more accounts</Btn></div> : null}
        {data.can.library && t.missingAutomation > 0 ? <div className="mt-4"><Btn variant="primary" onClick={onLibrary}>Set up the missing automations</Btn></div> : null}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- library
type Lib = {
  templates: Array<{ key: string; name: string; summary: string; tag: string; installed: number; fixes: string[]; version: number }>;
  guides: Array<{ standard: string; title: string; why: string; steps: string[] }>; accounts: number; cap: number; can: { install: boolean; bulk: boolean }; live: boolean;
};
type Plan = { template: { key: string; name: string; summary: string; tag: string }; rows: Array<{ locationId: string; name: string; state: string; reason: string }>; counts: Record<string, number>; capped: boolean; token: string; undo: string; dryRunAll: boolean };
const STATE_WORDS: Record<string, string> = { would_create: "Will be created", rehearse: "Rehearsal only", exists: "Already there", blocked: "Cannot be set up" };

export function LibraryTab({ q, accounts, onDone }: { q: string; accounts: Array<{ locationId: string; name: string }>; onDone: () => void }) {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<Lib>("workflows/library");
  const [key, setKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [find, setFind] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  void q;
  const shown = accounts.filter((a) => a.name.toLowerCase().includes(find.trim().toLowerCase()));
  if (loading && !data) return <SkeletonCards cards={2} label="Loading the library..." />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const run = async (path: "install-preview" | "install") => {
    setBusy(true); setMsg(null);
    try {
      const payload = { template: key, locationIds: [...picked], ...(path === "install" && plan ? { token: plan.token } : {}) };
      if (path === "install-preview") setPlan(await api.post<Plan>("workflows/install-preview", payload));
      else {
        const r = await api.post<{ results: Array<{ outcome: string }>; dryRun: boolean }>("workflows/install", payload);
        setMsg({ ok: true, text: r.dryRun ? `Rehearsal recorded for ${r.results.length} client account${r.results.length === 1 ? "" : "s"}. Nothing was sent to your CRM. See History.` : `Done for ${r.results.filter((x) => x.outcome === "done").length} of ${r.results.length}. See History.` });
        setPlan(null); setPicked(new Set()); onDone(); reload();
      }
    } catch (e) { setMsg({ ok: false, text: (e as { message?: string })?.message ?? "That did not work. Try again." }); } finally { setBusy(false); }
  };
  const many = data.can.bulk;
  return (
    <div data-testid="wf-library">
      {!data.live ? <InlineAlert tone="info" className="mb-4">Changes to your CRM are switched off for now. Setting up records a rehearsal and sends nothing.</InlineAlert> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {data.templates.map((t) => (
          <div key={t.key} className={`rounded-xl border p-4 ${key === t.key ? "border-primary" : ""}`} data-testid="wf-template">
            <p className="font-medium">{t.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t.summary}</p>
            <p className="mt-1 text-xs text-muted-foreground">Starts when a contact gets the tag <code>{t.tag}</code>.{t.fixes.length ? ` Fixes: ${t.fixes.join(", ").toLowerCase()}.` : ""} Set up in {t.installed} of {data.accounts} client accounts.</p>
            {data.can.install ? <div className="mt-3"><Btn onClick={() => { setKey(t.key); setPlan(null); setPicked(new Set()); setMsg(null); }}>Choose client accounts</Btn></div> : null}
          </div>
        ))}
      </div>
      {key && data.can.install ? (
        <Section title="Where should it go?" hint={many ? `Up to ${data.cap} at a time.` : "One client account at a time."}>
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a client account" aria-label="Find a client account" className="mb-2 min-h-10 w-full rounded-md border bg-background px-3 text-sm sm:w-72" />
          <div className="max-h-72 overflow-y-auto rounded-lg border" data-testid="wf-install-accounts">
            {shown.slice(0, 200).map((a) => (
              <label key={a.locationId} className="flex min-h-11 items-center gap-3 border-b px-3 text-sm last:border-b-0">
                <input type={many ? "checkbox" : "radio"} name="wf-acc" checked={picked.has(a.locationId)} onChange={(e) => setPicked((p) => { const n = many ? new Set(p) : new Set<string>(); if (e.target.checked) n.add(a.locationId); else n.delete(a.locationId); return n; })} />
                <span className="truncate">{a.name}</span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2"><Btn variant="primary" disabled={busy || picked.size === 0 || picked.size > data.cap} onClick={() => void run("install-preview")}>Preview ({picked.size})</Btn></div>
          {plan ? (
            <div className="mt-4 rounded-xl border p-3" data-testid="wf-install-preview">
              <p className="text-sm font-medium">{plan.template.name}: {plan.counts.would_create ?? 0} to create, {plan.counts.rehearse ?? 0} rehearsals, {plan.counts.exists ?? 0} already there, {plan.counts.blocked ?? 0} cannot be set up</p>
              <ul className="mt-2 divide-y text-sm">{plan.rows.map((r) => <li key={r.locationId} className="py-2"><span className="font-medium">{r.name}</span> <span className="text-muted-foreground">· {STATE_WORDS[r.state] ?? r.state}. {r.reason}</span></li>)}</ul>
              <p className="mt-2 text-xs text-muted-foreground">{plan.undo}</p>
              <div className="mt-3"><Btn variant="primary" disabled={busy || ((plan.counts.would_create ?? 0) + (plan.counts.rehearse ?? 0)) === 0} onClick={() => void run("install")}>{plan.dryRunAll ? "Record rehearsal" : "Set up now"}</Btn></div>
            </div>
          ) : null}
        </Section>
      ) : null}
      {msg ? <InlineAlert tone={msg.ok ? "success" : "warning"} className="mt-4">{msg.text}</InlineAlert> : null}
      <Section title="Automations that message customers" hint="SubSync sends a message only when a person presses Send, so it does not create these automations. Copy one from a client that has it, or follow the steps.">
        <div className="grid gap-3 md:grid-cols-2">
          {data.guides.map((g) => (
            <details key={g.standard} className="rounded-xl border p-3"><summary className="min-h-9 cursor-pointer font-medium">{g.title}</summary><p className="mt-1 text-sm text-muted-foreground">{g.why}</p><ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">{g.steps.map((s) => <li key={s}>{s}</li>)}</ol></details>
          ))}
        </div>
      </Section>
    </div>
  );
}
