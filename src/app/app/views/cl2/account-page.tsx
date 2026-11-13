"use client";

import { ChevronLeft, ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Cl2Account, Cl2Note } from "@/lib/analytics/clients2-types";
import { useApiClient } from "../../session";
import { EmptyState, ErrorState, SkeletonRows } from "../../ds";
import type { GoFn } from "../../nav";
import { AccountSettings } from "../cl3/settings";
import { agoText, c2post, c2q, copy, dayText, hasPayments, money, useC2 } from "./data";
import { LevelDot, PayChip } from "./chips";
import { MovedNumbers, OneThingCard } from "../ai-team/team-notes";

// One client account, in SubSync: the paid plan you sell them, credit balance, last activity, health with its evidence, setup, team, pipeline, speed to lead, appointments, your own notes and
// next steps, and the weekly proof to show them. Every card says exactly why a value is missing ("Needs permission: reconnect" only when the platform refused; "Not available from the
// platform yet" when it does not give it). Nothing here changes the CRM or messages anyone; the only writes are SubSync's own notes, who looks after the client, and the kind of business.
export type DrillOpen = (d: { title: string; reason: string; location: string; count: number }) => void;

const Card = ({ title, children, testId, wide }: { title: string; children: ReactNode; testId?: string; wide?: boolean }) => (
  <section className={`cl2-card ${wide ? "cl2-wide" : ""}`} aria-label={title} data-testid={testId}><h2 className="cl-h mb-2">{title}</h2>{children}</section>
);
const Row = ({ k, children }: { k: string; children: ReactNode }) => <div className="cl2-kv"><dt>{k}</dt><dd>{children}</dd></div>;
const minutes = (m: number | null) => (m === null ? "Not enough data" : m < 1 ? "Under a minute" : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${Math.round(m / 6) / 10} h` : `${Math.round(m / 144) / 10} d`);
const KIND: Record<Cl2Note["kind"], string> = { note: "Note", next_step: "Next step", promise: "Promise", plan: "Plan note" };

export function AccountPage({ id, onBack, flags, drill, onDrill, legacy, go, goTeam }: { id: string; onBack: () => void; flags: Record<string, boolean>; drill: ReactNode; onDrill: DrillOpen; legacy: ReactNode; go: GoFn; goTeam: (id: string) => void }) {
  const api = useApiClient();
  const [rev, setRev] = useState(0), [msg, setMsg] = useState<string | null>(null), [open, setOpen] = useState<null | "settings" | "legacy">(null);
  const r = useC2<Cl2Account>(c2q("account", { id, v: rev }));
  const say = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000); };
  const bump = () => setRev((n) => n + 1);

  if (r.loading && !r.data) return <div data-testid="cl2-account"><SkeletonRows rows={6} label="Opening the client account..." /></div>;
  if (r.error || !r.data) return <div data-testid="cl2-account"><button type="button" className="ap-link" onClick={onBack}><ChevronLeft aria-hidden className="inline size-4" />All client accounts</button>{r.error ? <ErrorState error={r.error} onRetry={r.reload} /> : <EmptyState title="Client account not found" body="It may have been removed or you may not have access to it." />}</div>;
  const a = r.data, p = a.plan;
  const setDrillOpen = (key: string, label: string, count: number) => onDrill({ title: `${a.name}: ${label}`, reason: key, location: id, count });
  return (
    <div data-testid="cl2-account" className="cl2-page ds-enter">
      <div className="print:hidden">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={onBack} className="ap-link -ml-1 inline-flex items-center gap-1" data-testid="cl2-back"><ChevronLeft aria-hidden className="size-4" />All client accounts</button>
        </div>
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[1.65rem] font-semibold leading-tight tracking-tight" data-testid="cl2-name">{a.name}</h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm"><PayChip plan={p} /><LevelDot level={a.health.level} />{a.row.verticalLabel && <span className="ap-fine">{a.row.verticalLabel}</span>}{a.email && <span className="ap-fine">{a.email}</span>}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {a.url && <a href={a.url} target="_blank" rel="noopener noreferrer" className="s6-btn inline-flex items-center gap-1" data-testid="cl2-crm">Open in your CRM<ExternalLink aria-hidden className="size-3.5" /><span className="sr-only"> ({a.name}, opens in a new tab)</span></a>}
            <button type="button" className="s6-btn" onClick={async () => say((await copy(a.summary)) ? "Summary copied. Paste it into your notes for the call." : "Copy it from the print view.")}>Copy a summary for a client call</button>
            <button type="button" className="s6-btn" onClick={() => window.print()}>Print</button>
          </div>
        </header>
        {msg && <p className="ap-fine mb-2" role="status" data-testid="cl2-msg">{msg}</p>}
        <div className="mb-3 grid gap-3"><OneThingCard locationId={id} /><MovedNumbers locationId={id} /></div>

        <div className="cl2-grid">
          <Card title="Paid plan you sell this client" testId="cl2-plan" wide>
            {p.state === "ok" ? (
              <dl className="cl2-dl">
                <Row k="Plan">{p.name ?? "Plan name not available"}</Row>
                <Row k="Payment status"><PayChip plan={p} />{p.statusRaw && <span className="ap-fine"> (the platform says: {p.statusRaw})</span>}</Row>
                <Row k="Price">{p.monthly !== null ? <>{money(p.priceAmount ?? 0, p.currency)} {p.interval === "year" ? "a year" : p.interval === "month" ? "a month" : p.interval ? `per ${p.interval}` : ""}</> : "Not given by the platform"}</Row>
                {p.trialDays ? <Row k="Free trial">{p.trialDays} days</Row> : null}
                <Row k="In this status">{p.daysInStatus === null ? "Not known yet" : <>{p.daysInStatus === 0 ? "Since today" : `${p.daysInStatus} days`} <span className="ap-fine">(SubSync first saw it {dayText(p.since)})</span></>}</Row>
              </dl>
            ) : <p className="text-lg font-semibold" data-testid="cl2-plan-state">{p.payLabel}</p>}
            <p className="ap-fine mt-2" data-testid="cl2-plan-explain">{p.explain}</p>
            {p.history.length > 0 && <details className="mt-2 text-sm"><summary className="ap-link cursor-pointer">Status history (from {p.historyStarts})</summary><ul className="mt-1 list-disc pl-5">{p.history.map((h) => <li key={h.at}>{dayText(h.at)}: {h.from ?? "unknown"} to {h.to ?? "unknown"}</li>)}</ul></details>}
            {p.checkedAt && <p className="ap-fine mt-2">Read {agoText(p.checkedAt)} from your CRM. The platform does not give the next payment date or the reason a payment failed.</p>}
            {hasPayments() && <button type="button" className="ap-link mt-1" onClick={() => go("payments" as never, id)}>Open in Payments</button>}
          </Card>

          <Card title="Credit balance" testId="cl2-wallet">
            {a.wallet.state === "ok" ? <dl className="cl2-dl"><Row k="Balance">{a.wallet.balance === null ? "Not given" : money(a.wallet.balance)}</Row>{a.wallet.credits !== null && <Row k="Free credits">{money(a.wallet.credits)}</Row>}</dl> : <p className="text-sm font-medium">{a.wallet.state === "needs_permission" ? "Needs permission: reconnect" : a.wallet.state === "not_available" ? "Not available from the platform yet" : "Not read yet"}</p>}
            <p className="ap-fine mt-2">{a.wallet.message}</p>
          </Card>

          <Card title="Usage and limits" testId="cl2-usage">
            <dl className="cl2-dl">
              <Row k="Contacts">{a.usage.contacts === null ? "Not counted yet" : a.usage.contactLimit ? `${a.usage.contacts.toLocaleString("en-US")} of ${a.usage.contactLimit.toLocaleString("en-US")} allowed` : `${a.usage.contacts.toLocaleString("en-US")}`}</Row>
              <Row k="Team members">{a.usage.userLimit ? `${a.usage.users ?? 0} of ${a.usage.userLimit} allowed` : `${a.usage.users ?? 0}`}</Row>
            </dl>
            <p className="ap-fine mt-2">Counts are from what SubSync has read. Limits come from the paid plan, when the platform gives them.</p>
          </Card>

          <Card title="Health" testId="cl2-health">
            <p className="mb-2"><LevelDot level={a.health.level} /> <span className="text-sm">{a.health.summary ?? (a.health.level === "unknown" ? "No data yet" : "Nothing needs a look.")}</span></p>
            {a.health.reasons.length > 0 && <div>{a.health.reasons.map((x) => <button key={x.reason} type="button" className="cl-reason" title={x.why} onClick={() => setDrillOpen(x.reason, x.label, x.count)}>{x.label}</button>)}</div>}
            <p className="ap-fine mt-2">{a.health.historyStarts ? `Based on the last 30 days; our own record starts ${a.health.historyStarts}.` : "Based on the last 30 days."}</p>
          </Card>

          <Card title="Speed to lead and replies" testId="cl2-work">
            <dl className="cl2-dl">
              <Row k="Typical first reply">{minutes(a.work.medianReplyMinutes)}</Row>
              <Row k="People waiting for a reply">{a.work.waiting > 0 ? <button type="button" className="ap-link" onClick={() => setDrillOpen("waiting", "waiting for a reply", a.work.waiting)}>{a.work.waiting}</button> : 0}{a.work.waitingOld > 0 && <span className="ap-fine"> ({a.work.waitingOld} over a day)</span>}</Row>
              <Row k="New contacts (last 30 days, every contact added)">{a.work.newLeads}</Row>
            </dl>
          </Card>

          <Card title="Appointments" testId="cl2-appts">
            <dl className="cl2-dl">
              <Row k="Show rate">{a.work.showRate === null ? "Not enough data" : `${Math.round(a.work.showRate * 100)}% of ${a.work.showRateN}`}</Row>
              <Row k="No outcome recorded">{a.work.unmarked > 0 ? <button type="button" className="ap-link" onClick={() => setDrillOpen("unmarked", "appointments with no outcome", a.work.unmarked)}>{a.work.unmarked}</button> : 0}</Row>
              <Row k="No-shows">{a.work.noshows > 0 ? <button type="button" className="ap-link" onClick={() => setDrillOpen("noshows", "no-shows", a.work.noshows)}>{a.work.noshows}</button> : 0}</Row>
              <Row k="Next appointment">{a.activity.nextAppointmentAt ? dayText(a.activity.nextAppointmentAt) : "None booked"}</Row>
            </dl>
          </Card>

          <Card title="Open pipeline" testId="cl2-pipeline">
            <dl className="cl2-dl">
              <Row k="Open deals">{a.work.openDeals.toLocaleString("en-US")} worth {money(a.work.openValue)}</Row>
              <Row k="Stuck 30+ days">{a.work.staleDealsPct === null ? "Not enough data" : <button type="button" className="ap-link" onClick={() => setDrillOpen("stale_deals", "deals stuck 30+ days", a.work.staleDealsN)}>{a.work.staleDealsN} ({Math.round(a.work.staleDealsPct * 100)}%)</button>}</Row>
              <Row k="Money won (30 days)">{money(a.work.wonValue)}</Row>
            </dl>
          </Card>

          <Card title="Last activity" testId="cl2-activity">
            <dl className="cl2-dl">
              <Row k="Last message from a lead">{agoText(a.activity.lastInboundAt)}</Row>
              <Row k="Last message sent by your team">{agoText(a.activity.lastOutboundAt)}</Row>
              <Row k="Last new contact">{agoText(a.activity.lastContactAt)}</Row>
              <Row k="Last read by SubSync">{agoText(a.activity.lastSyncAt)}</Row>
            </dl>
          </Card>

          <Card title="Setup checklist" testId="cl2-setup">
            <ul className="cl2-check">{a.checklist.map((c) => <li key={c.id} data-ok={c.ok}><span aria-hidden>{c.ok ? "Done" : "To do"}</span> {c.text}</li>)}</ul>
            {a.setup.channelsSeen.length > 0 ? <p className="ap-fine mt-2">Channels seen in the last 30 days: {a.setup.channelsSeen.join(", ")}.</p> : <p className="ap-fine mt-2">No messages seen in the last 30 days.</p>}
            {(a.setup.message || a.setup.needsHelp.length > 0) && (() => {
              // The permission explanation appears only when a read was really refused; otherwise the plain reasons are listed.
              const refused = a.setup.scopes.calendar === "needs_permission" || a.setup.scopes.users === "needs_permission" || p.state === "needs_permission";
              return (
                <details className="mt-2 text-sm"><summary className="ap-link cursor-pointer">{refused ? "Why \"Needs permission\"?" : "What needs fixing here?"}</summary>
                  <p className="mt-1">{refused ? `SubSync shows that only when your CRM refused a read. Reconnect SubSync and allow: calendars and appointments, team members${p.state === "needs_permission" ? ", and paid plans" : ""}. ` : ""}{a.setup.needsHelp.join(". ")}{a.setup.needsHelp.length ? "." : ""}</p></details>
              );
            })()}
          </Card>

          <Card title="Team" testId="cl2-team">
            <p className="text-sm">{a.team.people} {a.team.people === 1 ? "person" : "people"}{a.team.quiet ? `, ${a.team.quiet} quiet` : ""}.</p>
            <button type="button" className="ap-link mt-1" onClick={() => goTeam(id)} data-testid="cl2-team-link">See them in Team</button>
          </Card>

          <Card title="Installed apps" testId="cl2-apps"><p className="ap-fine">{a.apps.message}</p></Card>

          <Card title="Who looks after this client" testId="cl2-manage">
            <Manage a={a} flags={flags} api={api} onChanged={bump} say={say} />
            <button type="button" className="ap-link mt-2" onClick={() => setOpen(open === "settings" ? null : "settings")}>Quiet alerts and reply target</button>
          </Card>

          {a.receipt && (
            <Card title="Proof to show this client" testId="cl2-receipt" wide>
              {a.receipt.enough ? <ul className="list-disc pl-5 text-sm">{a.receipt.lines.map((l) => <li key={l}>{l}</li>)}</ul> : <p className="ap-fine">Not enough activity last week to show a proof yet.</p>}
              <div className="mt-2 flex flex-wrap gap-2"><button type="button" className="s6-btn" disabled={!a.receipt.enough} onClick={async () => say((await copy(`${a.name}, week of ${a.receipt!.weekStart}\n${a.receipt!.lines.join("\n")}`)) ? "Proof copied. It has no internal terms." : "Copy it from the print view.")}>Copy</button><button type="button" className="s6-btn" onClick={() => window.print()}>Print</button></div>
            </Card>
          )}

          {flags.cl2_notes && <Notes a={a} api={api} onChanged={bump} say={say} />}
        </div>

        {open === "settings" && <AccountSettings key={id} id={id} name={a.name} onClose={() => setOpen(null)} onChanged={bump} />}
        {drill}
        <section className="mt-6 border-t pt-3" aria-label="Fee, renewal and call log">
          <button type="button" className="ap-link" aria-expanded={open === "legacy"} onClick={() => setOpen(open === "legacy" ? null : "legacy")} data-testid="cl2-legacy-toggle">{open === "legacy" ? "Hide" : "Show"} fee, renewal, call log and what to say</button>
          {open === "legacy" && <div className="mt-3">{legacy}</div>}
        </section>
      </div>
      <div className="hidden whitespace-pre-wrap text-sm print:block" data-testid="cl2-print">{a.summary}{a.receipt?.enough ? `\n\nLast week\n${a.receipt.lines.join("\n")}` : ""}</div>
    </div>
  );
}

function Manage({ a, flags, api, onChanged, say }: { a: Cl2Account; flags: Record<string, boolean>; api: ReturnType<typeof useApiClient>; onChanged: () => void; say: (m: string) => void }) {
  const [name, setName] = useState(a.row.manager ?? ""), [busy, setBusy] = useState(false), [kind, setKind] = useState(a.row.vertical ?? "");
  const VERTICALS: Array<[string, string]> = [["med_spa", "Med spa"], ["solar", "Solar"], ["home_services", "Home services"], ["real_estate", "Real estate"], ["legal", "Legal"], ["coaching", "Coaching"], ["other", "Other"]];
  const saveOwner = async () => { setBusy(true); try { await api.post("clients/act/owner", { location: a.locationId, owner: name.trim() || null }); say(name.trim() ? `${name.trim()} now looks after this client.` : "Cleared."); onChanged(); } catch (e) { say(e instanceof Error ? e.message : "That did not work."); } finally { setBusy(false); } };
  const saveKind = async (v: string) => { setKind(v); setBusy(true); try { await c2post(api, "tag", { locations: [a.locationId], vertical: v || null, step: "do" }); say("Saved the kind of business."); onChanged(); } catch (e) { say(e instanceof Error ? e.message : "That did not work."); } finally { setBusy(false); } };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2"><input className="ap-field" aria-label="Who looks after this client" placeholder="A name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /><button type="button" className="s6-btn" disabled={busy} onClick={saveOwner}>Save</button></div>
      {flags.cl2_bulk && <label className="ap-fine inline-flex items-center gap-2">Kind of business<select className="ap-field" value={kind} disabled={busy} onChange={(e) => saveKind(e.target.value)}><option value="">Not set</option>{VERTICALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
      <p className="ap-fine">Only changes what SubSync shows. Nothing is changed in your CRM.</p>
    </div>
  );
}

function Notes({ a, api, onChanged, say }: { a: Cl2Account; api: ReturnType<typeof useApiClient>; onChanged: () => void; say: (m: string) => void }) {
  const [kind, setKind] = useState<Cl2Note["kind"]>("note"), [text, setText] = useState(""), [due, setDue] = useState(""), [pin, setPin] = useState(false), [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ id: string; body: string } | null>(null), [del, setDel] = useState<{ id: string; title: string; typed: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); try { await fn(); say(ok); onChanged(); } catch (e) { say(e instanceof Error ? e.message : "That did not work."); } finally { setBusy(false); } };
  const add = () => run(async () => { await c2post(api, "note-add", { location: a.locationId, kind, body: text, dueOn: due || null, pinned: pin }); setText(""); setDue(""); setPin(false); }, "Saved.");
  const title = (b: string) => b.replace(/\s+/g, " ").trim().slice(0, 30);
  return (
    <Card title="Notes and next steps" testId="cl2-notes" wide>
      <p className="ap-fine mb-2">Private to you and your team. Never shown to the client and never sent anywhere.</p>
      <div className="flex flex-wrap items-start gap-2">
        <select className="ap-field" aria-label="Kind of note" value={kind} onChange={(e) => setKind(e.target.value as Cl2Note["kind"])}><option value="note">Note</option><option value="next_step">Next step</option><option value="promise">Promise to the client</option></select>
        <textarea className="ap-field min-w-[14rem] flex-1" rows={2} maxLength={2000} aria-label="Write a note" placeholder="Write a note, a next step or a promise" value={text} onChange={(e) => setText(e.target.value)} />
        <input type="date" className="ap-field" aria-label="Due date (optional)" value={due} onChange={(e) => setDue(e.target.value)} />
        <label className="ap-fine inline-flex min-h-9 items-center gap-1"><input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} />Pin</label>
        <button type="button" className="s6-btn" data-kind="primary" disabled={busy || !text.trim()} onClick={add} data-testid="cl2-note-add">Add</button>
      </div>
      {a.notes.length === 0 ? <p className="ap-fine mt-3">No notes yet. Add the next step so nothing is forgotten.</p> : (
        <ul className="cl-notes" data-testid="cl2-note-list">
          {a.notes.map((n) => (
            <li key={n.id} data-done={n.done}>
              <div className="flex flex-wrap items-center gap-2"><span className="ap-chip">{KIND[n.kind]}</span>{n.pinned && <span className="ap-chip" data-tone="cyan">Pinned</span>}{n.dueOn && <span className="ap-fine">Due {n.dueOn}</span>}<span className="ap-fine">{n.author ?? "Someone"}, {agoText(n.createdAt)}</span></div>
              {edit?.id === n.id ? (
                <div className="mt-1"><textarea className="ap-field w-full" rows={3} maxLength={2000} aria-label="Edit the note" value={edit.body} onChange={(e) => setEdit({ id: n.id, body: e.target.value })} />
                  <p className="ap-fine mt-1">Preview of what it will say: {edit.body.trim() || "(empty)"}</p>
                  <div className="mt-1 flex gap-2"><button type="button" className="s6-btn" data-kind="primary" disabled={busy || !edit.body.trim()} onClick={() => run(async () => { await c2post(api, "note-update", { location: a.locationId, id: n.id, body: edit.body }); setEdit(null); }, "Saved.")}>Save change</button><button type="button" className="ap-link" onClick={() => setEdit(null)}>Cancel</button></div></div>
              ) : <p style={{ textDecoration: n.done ? "line-through" : undefined }}>{n.body}</p>}
              <div className="mt-1 flex flex-wrap gap-3 text-sm">
                {(n.kind === "next_step" || n.kind === "promise") && <button type="button" className="ap-link" disabled={busy} onClick={() => run(() => c2post(api, "note-update", { location: a.locationId, id: n.id, done: !n.done }), n.done ? "Reopened." : "Marked done.")}>{n.done ? "Reopen" : "Mark done"}</button>}
                <button type="button" className="ap-link" disabled={busy} onClick={() => run(() => c2post(api, "note-update", { location: a.locationId, id: n.id, pinned: !n.pinned }), n.pinned ? "Unpinned." : "Pinned.")}>{n.pinned ? "Unpin" : "Pin"}</button>
                <button type="button" className="ap-link" onClick={() => setEdit({ id: n.id, body: n.body })}>Edit</button>
                <button type="button" className="ap-link" onClick={() => setDel({ id: n.id, title: title(n.body), typed: "" })}>Delete</button>
              </div>
              {del?.id === n.id && (
                <div className="cl2-confirm" role="alertdialog" aria-label="Confirm delete">
                  <p className="text-sm">This cannot be undone. To delete it, type its first words: <b>{del.title}</b></p>
                  <div className="mt-1 flex flex-wrap gap-2"><input className="ap-field" aria-label="Type the first words of the note" value={del.typed} onChange={(e) => setDel({ ...del, typed: e.target.value })} />
                    <button type="button" className="s6-btn" disabled={busy || del.typed.trim().replace(/\s+/g, " ").toLowerCase() !== del.title.toLowerCase()} onClick={() => run(async () => { await c2post(api, "note-delete", { location: a.locationId, id: n.id, confirm: del.typed }); setDel(null); }, "Deleted.")} data-testid="cl2-note-delete">Delete note</button>
                    <button type="button" className="ap-link" onClick={() => setDel(null)}>Keep it</button></div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
