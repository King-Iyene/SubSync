"use client";

import { useState, type FormEvent } from "react";
import { INDUSTRY_KEY_LABEL, PLAYBOOKS } from "@/lib/analytics/playbooks";
import { HOWTO_MAX, MAX_TEMPLATE_STEPS, REASON_WORDS, STEP_LABEL_MAX, STUCK_CHOICES, TEMPLATE_NAME_MAX, type OnboardingItem } from "@/lib/analytics/client-success";
import { useApiClient, useData } from "../../session";
import { EmptyState, HowTo, InlineAlert, Section, SkeletonRows } from "../../ds";
import { remember, remembered } from "../../ds/remember";
import { Badge, Btn, ErrorBox, ExtLink, inputClass } from "../../ui";
import type { GoFn } from "../../nav";

// The Onboarding tab (N63): one checklist per client, built from what SubSync can check by itself, the steps your team ticks off, the steps of the
// template for the client's kind of business, and steps you add to one client. Every unfinished step has a "Fix it" link to the page where it is fixed and
// a short how-to; each step can be given to someone and given a due date; every change is kept in a history; and the clients that have been stuck for
// more than N days are listed first. Nothing here sends a message or changes the CRM: the links open the CRM for you to do it.
type Tpl = { id: string; name: string; industryKey: string | null; steps: Array<{ key: string; label: string; howto?: string }> };
type ClientOnb = {
  locationId: string; name: string | null; owner: string | null; url: string; industry: string | null; template: { id: string; name: string } | null; completionPct: number; daysIn: number | null;
  lastProgressAt: string | null; items: OnboardingItem[]; stuck: boolean; openCount: number; overdueCount: number;
};
type Data = { stuckDays: number; defaultStuckDays: number; templates: Tpl[]; stuck: Array<{ locationId: string; name: string | null; daysIn: number | null; completionPct: number; next: string[] }>; clients: ClientOnb[] };
type Hist = { history: Array<{ text: string; at: string }> };

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short" });
// A due date is a calendar day, not a moment: it is written as that day in every time zone (the UTC reading), never the day before in the Americas.
const dayOnly = (on: string) => new Date(`${on}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
const dueWords = (d: OnboardingItem["due"], on: string | null) => (d === "overdue" ? `overdue, was due ${on ? dayOnly(on) : ""}` : d === "soon" ? `due ${on ? dayOnly(on) : "soon"}` : on ? `due ${dayOnly(on)}` : "");

function StepRow({ it, loc, name, busy, run, go }: { it: OnboardingItem; loc: string; name: string; busy: boolean; run: (fn: () => Promise<unknown>) => void; go: GoFn }) {
  const api = useApiClient();
  const [how, setHow] = useState(false);
  const [who, setWho] = useState(it.assignee ?? "");
  const put = (body: Record<string, unknown>) => run(() => api.put(`client-onboarding/${loc}/steps`, { key: it.key, ...body }));
  const mark = it.status === "done" ? "✓" : it.status === "unknown" ? "?" : "";
  return (
    <li className="py-2.5 text-sm" data-testid="onboarding-step" data-status={it.status}>
      <div className="flex items-start gap-2">
        {it.canTick
          ? <input type="checkbox" className="mt-1 size-4" checked={it.status === "done"} disabled={busy} aria-label={`${it.label}, ${name}`} onChange={(e) => put({ done: e.target.checked })} />
          : <span aria-hidden className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center border text-[10px]">{mark}</span>}
        <div className="min-w-0 flex-1">
          <p className={it.status === "done" ? "text-muted-foreground line-through" : "font-medium"}>{it.label}
            {it.status === "unknown" && <span className="ml-2 text-xs font-normal text-muted-foreground no-underline">can&apos;t tell</span>}
            {it.due && <span className="ml-2"><Badge tone={it.due === "overdue" ? "bad" : it.due === "soon" ? "warn" : "neutral"}>{dueWords(it.due, it.dueOn)}</Badge></span>}
          </p>
          {it.reason && <p className="text-xs text-muted-foreground">{REASON_WORDS[it.reason]}{it.detail && it.reason !== "permission" ? ` ${it.detail}.` : ""}</p>}
          {it.status === "done" && it.doneBy && <p className="text-xs text-muted-foreground">Finished by {it.doneBy}{it.doneAt ? `, ${shortDate(it.doneAt)}` : ""}</p>}
          {it.status === "todo" && it.detail && !it.reason && <p className="text-xs text-muted-foreground">{it.detail}</p>}
          {it.status !== "done" && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {it.fix?.url && <ExtLink href={it.fix.url}>{it.fix.label} in your CRM</ExtLink>}
              {it.fix?.view && <button type="button" onClick={() => go(it.fix!.view as "email")} className="min-h-8 text-sm font-medium text-primary underline-offset-4 hover:underline">{it.fix.label}</button>}
              {it.howto && <button type="button" aria-expanded={how} onClick={() => setHow(!how)} className="min-h-8 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">{how ? "Hide how to" : "How to"}</button>}
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Given to
                <input className={`${inputClass} h-8 w-32 px-2 py-1 text-xs`} value={who} maxLength={60} placeholder="Nobody yet" aria-label={`Who is on "${it.label}" for ${name}`} onChange={(e) => setWho(e.target.value)} onBlur={() => { if (who.trim() !== (it.assignee ?? "")) put({ assignee: who.trim() }); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Due
                <input type="date" className={`${inputClass} h-8 w-36 px-2 py-1 text-xs`} value={it.dueOn ?? ""} aria-label={`Due date of "${it.label}" for ${name}`} onChange={(e) => put({ dueOn: e.target.value })} />
              </label>
              {it.key.startsWith("step:") && <button type="button" className="min-h-8 text-xs text-muted-foreground underline hover:text-destructive" disabled={busy} onClick={() => run(() => api.del(`client-onboarding/${loc}/steps?key=${encodeURIComponent(it.key)}`))}>Remove step</button>}
            </div>
          )}
          {how && it.howto && (
            <div className="mt-2 border-l-2 border-primary pl-3 text-xs" data-testid="step-howto">
              {it.where && <p className="font-medium">Where: {it.where}</p>}
              <p className="text-muted-foreground">{it.howto}</p>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function AddStep({ loc, name, run }: { loc: string; name: string; run: (fn: () => Promise<unknown>) => void }) {
  const api = useApiClient();
  const [label, setLabel] = useState("");
  const [who, setWho] = useState("");
  const [due, setDue] = useState("");
  return (
    <form className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3" onSubmit={(e: FormEvent) => { e.preventDefault(); if (!label.trim()) return; run(() => api.post(`client-onboarding/${loc}/steps`, { label, assignee: who, dueOn: due })); setLabel(""); setWho(""); setDue(""); }}>
      <div className="min-w-56 flex-1"><label className="mb-1 block text-xs text-muted-foreground" htmlFor={`add-${loc}`}>Add a step for {name}</label><input id={`add-${loc}`} className={inputClass} maxLength={STEP_LABEL_MAX} value={label} placeholder="e.g. Order the welcome gift" onChange={(e) => setLabel(e.target.value)} /></div>
      <div><label className="mb-1 block text-xs text-muted-foreground" htmlFor={`addw-${loc}`}>Given to</label><input id={`addw-${loc}`} className={`${inputClass} w-36`} maxLength={60} value={who} onChange={(e) => setWho(e.target.value)} /></div>
      <div><label className="mb-1 block text-xs text-muted-foreground" htmlFor={`addd-${loc}`}>Due</label><input id={`addd-${loc}`} type="date" className={`${inputClass} w-40`} value={due} onChange={(e) => setDue(e.target.value)} /></div>
      <Btn type="submit" disabled={!label.trim()}>Add step</Btn>
    </form>
  );
}

function History({ loc }: { loc: string }) {
  const [open, setOpen] = useState(false);
  const { data, error, loading, reload } = useData<Hist>(open ? `client-onboarding/${loc}/history` : null);
  return (
    <div className="mt-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="min-h-8 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">{open ? "Hide history" : "Show history"}</button>
      {open && (error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <SkeletonRows rows={2} /> : data && (
        data.history.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">Nothing has been ticked off, given to anyone or dated yet.</p> : (
          <ul className="mt-2 space-y-1 text-xs" aria-label="Onboarding history">{data.history.map((h, i) => <li key={i}><span className="text-muted-foreground">{shortDate(h.at)}</span> {h.text}</li>)}</ul>
        )))}
    </div>
  );
}

export function ClientCard({ c, open, onToggle, reload, go }: { c: ClientOnb; open: boolean; onToggle: () => void; reload: () => void; go: GoFn }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = (fn: () => Promise<unknown>) => { setBusy(true); setErr(null); fn().then(reload).catch((e: Error) => setErr(e.message)).finally(() => setBusy(false)); };
  const name = c.name ?? "this client";
  const todo = c.items.filter((i) => i.status === "todo");
  return (
    <li id={`onb-${c.locationId}`} className="border-b py-4" data-testid="onboarding-client">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => go("account", c.locationId)} className="text-sm font-semibold hover:underline">{c.name ?? "Unnamed account"}</button>
            {c.completionPct === 100 && <Badge tone="good">Fully onboarded</Badge>}
            {c.stuck && <Badge tone="bad">Stuck</Badge>}
            {c.overdueCount > 0 && <Badge tone="bad">{c.overdueCount} overdue</Badge>}
            {c.template && <span className="text-xs text-muted-foreground">Template: {c.template.name}</span>}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="h-1.5 w-full max-w-xs overflow-hidden bg-muted" role="progressbar" aria-valuenow={c.completionPct} aria-valuemin={0} aria-valuemax={100} aria-label={`${name} onboarding progress`}>
              <div className={`h-full ${c.completionPct >= 80 ? "bg-success" : c.completionPct >= 50 ? "bg-warning" : "bg-destructive"}`} style={{ width: `${c.completionPct}%` }} />
            </div>
            <span className="text-sm tabular-nums">{c.completionPct}%</span>
            <span className="text-xs text-muted-foreground">{c.daysIn === null ? "start date unknown" : `added ${c.daysIn} day${c.daysIn === 1 ? "" : "s"} ago`}</span>
          </div>
          {!open && todo.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Still to do: {todo.slice(0, 3).map((m) => m.label).join(" · ")}{todo.length > 3 ? ` · and ${todo.length - 3} more` : ""}</p>}
        </div>
        <Btn onClick={onToggle}>{open ? "Hide checklist" : "Open checklist"}</Btn>
      </div>
      {open && (
        <div className="mt-3">
          {err && <InlineAlert tone="danger" className="mb-2">{err}</InlineAlert>}
          <ul className="divide-y" aria-label={`Checklist for ${name}`}>{c.items.map((it) => <StepRow key={it.key} it={it} loc={c.locationId} name={name} busy={busy} run={run} go={go} />)}</ul>
          <AddStep loc={c.locationId} name={name} run={run} />
          <History loc={c.locationId} />
        </div>
      )}
    </li>
  );
}

// ---- templates
const KINDS = [{ key: "", label: "Every client" }, ...PLAYBOOKS.map((p) => ({ key: p.id, label: INDUSTRY_KEY_LABEL[p.id] })), { key: "other", label: INDUSTRY_KEY_LABEL.other }];
type Draft = { id: string | null; name: string; industryKey: string; steps: Array<{ key?: string; label: string; howto: string }> };
const toDraft = (t: Tpl | null): Draft => (t ? { id: t.id, name: t.name, industryKey: t.industryKey ?? "", steps: t.steps.map((s) => ({ key: s.key, label: s.label, howto: s.howto ?? "" })) } : { id: null, name: "", industryKey: "", steps: [{ label: "", howto: "" }] });

function TemplateEditor({ start, onDone }: { start: Tpl | null; onDone: (saved: boolean) => void }) {
  const api = useApiClient();
  const [d, setD] = useState<Draft>(toDraft(start));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setStep = (i: number, patch: Partial<Draft["steps"][number]>) => setD({ ...d, steps: d.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  return (
    <form className="mt-3 space-y-3 border-l-2 border-primary pl-4" onSubmit={async (e: FormEvent) => {
      e.preventDefault(); setBusy(true); setMsg(null);
      try { await api.put("client-onboarding/templates", { id: d.id, name: d.name, industryKey: d.industryKey || null, steps: d.steps.filter((s) => s.label.trim()).map((s) => ({ key: s.key, label: s.label, howto: s.howto })) }); onDone(true); }
      catch (err) { setMsg((err as Error).message); } finally { setBusy(false); }
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="mb-1 block text-xs text-muted-foreground" htmlFor="tpl-name">Template name</label><input id="tpl-name" className={inputClass} maxLength={TEMPLATE_NAME_MAX} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Clinic onboarding" /></div>
        <div><label className="mb-1 block text-xs text-muted-foreground" htmlFor="tpl-kind">Used for</label><select id="tpl-kind" className={inputClass} value={d.industryKey} onChange={(e) => setD({ ...d, industryKey: e.target.value })}>{KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></div>
      </div>
      <div>
        <p className="mb-1 text-xs text-muted-foreground">Steps, in order. The how-to is optional and shows when someone presses How to.</p>
        <ul className="space-y-2">
          {d.steps.map((s, i) => (
            <li key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input className={inputClass} aria-label={`Step ${i + 1} name`} maxLength={STEP_LABEL_MAX} value={s.label} onChange={(e) => setStep(i, { label: e.target.value })} placeholder="What needs to happen" />
              <input className={inputClass} aria-label={`Step ${i + 1} how to`} maxLength={HOWTO_MAX} value={s.howto} onChange={(e) => setStep(i, { howto: e.target.value })} placeholder="How to do it (optional)" />
              <Btn variant="ghost" onClick={() => setD({ ...d, steps: d.steps.filter((_, k) => k !== i) })}>Remove</Btn>
            </li>
          ))}
        </ul>
        {d.steps.length < MAX_TEMPLATE_STEPS && <div className="mt-2"><Btn onClick={() => setD({ ...d, steps: [...d.steps, { label: "", howto: "" }] })}>Add a step</Btn></div>}
      </div>
      <div className="flex flex-wrap items-center gap-2"><Btn type="submit" variant="primary" disabled={busy || !d.name.trim()}>Save template</Btn><Btn onClick={() => onDone(false)}>Cancel</Btn>{msg && <span className="text-sm text-destructive" role="alert">{msg}</span>}</div>
    </form>
  );
}

function Templates({ templates, reload }: { templates: Tpl[]; reload: () => void }) {
  const api = useApiClient();
  const [edit, setEdit] = useState<Tpl | "new" | null>(null);
  const [starter, setStarter] = useState<string>(PLAYBOOKS[0].id);
  const [msg, setMsg] = useState<string | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, done?: string) => { setMsg(null); try { await fn(); reload(); if (done) setMsg(done); } catch (e) { setMsg((e as Error).message); } };
  const kindOf = (t: Tpl) => (t.industryKey ? INDUSTRY_KEY_LABEL[t.industryKey] ?? t.industryKey : "every client");
  return (
    <Section title="Checklist templates" hint="A client gets the template for its kind of business, or the one for every client. Its steps are added to the checks SubSync does by itself.">
      {msg && <p className="mb-3 text-sm text-muted-foreground" role="status">{msg}</p>}
      {templates.length === 0 && edit === null && <EmptyState compact title="No templates yet" body="Write the steps you take with every new client, or start from an industry playbook below. Each client's checklist then includes them." action={<Btn variant="primary" onClick={() => setEdit("new")}>Write your first template</Btn>} />}
      <ul className="divide-y">
        {templates.map((t) => (
          <li key={t.id} className="py-3" data-testid="template">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="text-sm font-medium">{t.name}</p><p className="text-xs text-muted-foreground">For {kindOf(t)} · {t.steps.length} step{t.steps.length === 1 ? "" : "s"}: {t.steps.slice(0, 3).map((s) => s.label).join(", ")}{t.steps.length > 3 ? "…" : ""}</p></div>
              <div className="flex gap-2">
                <Btn onClick={() => setEdit(t)}>Edit</Btn>
                {sure === t.id ? <><Btn variant="primary" onClick={() => { setSure(null); void run(() => api.del(`client-onboarding/templates?id=${t.id}`), "Template deleted. Ticks already made on clients are kept.") }}>Yes, delete</Btn><Btn onClick={() => setSure(null)}>Keep it</Btn></> : <Btn variant="ghost" onClick={() => setSure(t.id)}>Delete</Btn>}
              </div>
            </div>
            {edit !== "new" && edit?.id === t.id && <TemplateEditor key={t.id} start={t} onDone={(saved) => { setEdit(null); if (saved) { reload(); setMsg("Template saved."); } }} />}
          </li>
        ))}
      </ul>
      {edit === "new" && <TemplateEditor start={null} onDone={(saved) => { setEdit(null); if (saved) { reload(); setMsg("Template saved."); } }} />}
      {edit === null && templates.length > 0 && <div className="mt-3"><Btn onClick={() => setEdit("new")}>New template</Btn></div>}
      <div className="mt-4 flex flex-wrap items-end gap-2 border-t pt-4">
        <div><label className="mb-1 block text-xs text-muted-foreground" htmlFor="starter">Start from an industry playbook</label><select id="starter" className={`${inputClass} w-72`} value={starter} onChange={(e) => setStarter(e.target.value)}>{PLAYBOOKS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
        <Btn onClick={() => void run(() => api.post("client-onboarding/templates/starter", { playbook: starter }), "Template added from the playbook. Edit it to make it yours.")}>Add template</Btn>
      </div>
    </Section>
  );
}

export function OnboardingTab({ go }: { go: GoFn }) {
  const [days, setDays] = useState<number>(() => { const v = Number(remembered("stuck-days")); return (STUCK_CHOICES as readonly number[]).includes(v) ? v : 14; });
  const { data, error, loading, reload } = useData<Data>(`client-onboarding?stuck=${days}`);
  const [open, setOpen] = useState<string | null>(null);
  if (loading && !data) return <SkeletonRows rows={5} label="Loading onboarding..." />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const pick = (n: number) => { setDays(n); remember("stuck-days", String(n)); };
  return (
    <div>
      <HowTo id="clients-onboarding" title="How onboarding works" action={<button type="button" onClick={() => go("help")} className="text-xs font-medium text-primary underline">More in Getting started</button>}>
        Open a client&apos;s checklist. SubSync ticks what it can check itself (pipeline, contacts, calendar, profile, email sending). For anything unfinished, press <strong>Fix it</strong> to open the right page in your CRM, or <strong>How to</strong> for the steps. Give a step to someone and set a due date to keep it moving.
      </HowTo>

      <Section title="Clients stuck in onboarding" hint="Not fully set up long after they were added."
        action={<label className="flex items-center gap-2 text-xs text-muted-foreground">Stuck means more than<select className={`${inputClass} h-8 w-24 py-0 text-xs`} aria-label="Days before a client counts as stuck" value={days} onChange={(e) => pick(Number(e.target.value))}>{STUCK_CHOICES.map((n) => <option key={n} value={n}>{n} days</option>)}</select></label>}>
        {data.stuck.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="no-stuck">No client is stuck: every client that is not fully set up was added less than {data.stuckDays} days ago.</p> : (
          <ul className="divide-y" aria-label="Stuck clients" data-testid="stuck-list">
            {data.stuck.map((s) => (
              <li key={s.locationId} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0"><p className="font-medium">{s.name ?? "Unnamed account"} <span className="font-normal text-muted-foreground">{s.completionPct}% done, added {s.daysIn} days ago</span></p>{s.next.length > 0 && <p className="text-xs text-muted-foreground">Next: {s.next.join(" · ")}</p>}</div>
                <Btn onClick={() => { setOpen(s.locationId); document.getElementById(`onb-${s.locationId}`)?.scrollIntoView({ block: "start" }); }}>Open checklist</Btn>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Checklists" hint="Least finished first.">
        {data.clients.length === 0 ? <EmptyState title="No clients yet" body="Client accounts appear here once the first sync finishes." /> : (
          <ul aria-label="Client checklists">{data.clients.map((c) => <ClientCard key={c.locationId} c={c} open={open === c.locationId} onToggle={() => setOpen(open === c.locationId ? null : c.locationId)} reload={reload} go={go} />)}</ul>
        )}
      </Section>

      <Templates templates={data.templates} reload={reload} />
    </div>
  );
}
