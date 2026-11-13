"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CfDealRow, CfDealsList, CfDealsSummary, CfOptions, CfRecoverList, CfRecoverRow, CfRecoverSummary, CfSave, CfSettings, CfTeam } from "@/lib/analytics/cash-types";
import { KIND_WORDS, money, RECOVER_KINDS, type RecoverKind } from "@/lib/analytics/cash-intel";
import { ApiError, useApiClient, useData } from "../../session";
import { EmptyState, ErrorState, SkeletonRows } from "../../ds";
import { OpenLeadButton } from "../../ds/open-lead-button";
import "./cash.css";

// The cash features, three surfaces on the screens people already use:
//   SaveCard      on Today: the accounts most at risk this morning, the evidence, the dollar line (estimate, formula one tap away) and one button each.
//   RecoverTab    on Today: the missed-lead recovery list with a dollar line, Open, bulk "give to me / give to someone" with a preview and an undo, set aside, and the recovered proof line.
//   SlippingPanel in Pipeline: deals going stale for their stage, about to, and lost (with the reason only when the CRM recorded one). Rows open the deal.
// Everything reads the cash API (src/lib/api/cash-routes.ts). Nothing here messages a lead; the one CRM change is an owner change, previewed first and undoable.

const num = (n: number) => n.toLocaleString("en-US");
const failText = (e: unknown) => (e instanceof ApiError ? e.message : "That did not work. Please try again.");
const notOn = (e: unknown) => /not switched on/i.test(String((e as { message?: string } | null)?.message ?? e ?? ""));
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Which cash features are switched on for this person (null while loading or when none is). Used to show the Recover tab and the Slipping tab only when they exist. */
export function useCashFlags(): { flags: Record<string, boolean> | null; level: "all" | "account" | "self" } {
  const r = useData<CfOptions & { flags: Record<string, boolean>; level: "all" | "account" | "self" }>("cash?part=options");
  return { flags: r.data?.flags ?? null, level: r.data?.level ?? "all" };
}

function How({ text, id }: { text: string; id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ap-link cf-how" aria-expanded={open} onClick={() => setOpen(!open)}>How is this worked out?</button>
      {open && <p className="ap-fine" data-testid={`cf-formula-${id}`}>{text}</p>}
    </>
  );
}

// ------------------------------------------------------------------ Save this account

export function SaveCard({ openList, go }: { openList: (location: string) => void; go: (view: "speed" | "clients" | "pipeline", location: string) => void }) {
  const api = useApiClient();
  const r = useData<CfSave>("cash?part=save");
  const [busy, setBusy] = useState<string | null>(null), [problem, setProblem] = useState<string | null>(null);
  if (r.error && notOn(r.error)) return null;
  if (r.loading && !r.data) return <section className="cf-card" aria-label="Accounts to save today"><SkeletonRows rows={2} label="Checking every client account..." /></section>;
  if (r.error) return <section className="cf-card"><ErrorState error={r.error} onRetry={r.reload} /></section>;
  const d = r.data;
  if (!d || (!d.headline && d.accounts.length === 0)) return null;
  const act = async (name: string, body: object, key: string) => {
    setBusy(key); setProblem(null);
    try { await api.post(`cash/act/${name}`, body); r.reload(); } catch (e) { setProblem(failText(e)); } finally { setBusy(null); }
  };
  return (
    <section className="cf-card" aria-label="Accounts to save today" data-testid="cf-save">
      <h2 className="cl-h">Accounts to save today</h2>
      <p className="cl-sentence" data-testid="cf-save-headline">{d.headline}</p>
      {d.accounts.length === 0 && <p className="ap-fine">Checked {num(d.checked)} client {d.checked === 1 ? "account" : "accounts"}: reply speed, waiting people, no-shows, activity, setup and quiet deals.</p>}
      <ol className="cf-list">
        {d.accounts.map((a, n) => (
          <li key={a.locationId} className="cf-acct" data-testid={`cf-save-${a.locationId}`}>
            <span className="td-rank" aria-hidden>{n + 1}</span>
            <div className="td-main">
              <b className="cf-name">{a.name}</b>
              <ul className="cf-ev">{a.evidence.slice(0, 3).map((e) => <li key={e.key}>{e.text}</li>)}</ul>
              <p className="ap-fine">{a.dollarText}</p>
            </div>
            <div className="td-side">
              <button type="button" className="s6-btn" data-kind="primary" onClick={() => (a.list === "recover" ? openList(a.locationId) : go(a.list === "deals" ? "pipeline" : a.list === "speed" ? "speed" : "clients", a.locationId))}>Open the list</button>
              <button type="button" className="ap-link" disabled={busy === a.locationId} onClick={() => void act("mute", { location: a.locationId, days: 7 }, a.locationId)}>Pause for 7 days</button>
            </div>
          </li>
        ))}
      </ol>
      {d.more > 0 && <p className="ap-fine">And {d.more} more. They are in Clients, Needs attention.</p>}
      {d.accounts.length > 0 && <How id="save" text={d.formula} />}
      {d.muted.length > 0 && (
        <ul className="cl-steps" data-testid="cf-muted" aria-label="Paused accounts">
          {d.muted.map((m) => <li key={m.id}><b>{m.name}</b><span>paused until {m.until.slice(0, 10)}</span><button type="button" className="ap-link" disabled={busy === m.id} onClick={() => void act("unmute", { id: m.id }, m.id)}>Bring back</button></li>)}
        </ul>
      )}
      {problem && <p className="ap-fine" role="alert">{problem}</p>}
      <p className="ap-fine">{d.historyStarts ? `We have kept this record since ${d.historyStarts}.` : "We start keeping this record at the next refresh."} Estimates are labelled. Nothing here messages a lead.</p>
    </section>
  );
}

// ------------------------------------------------------------------ Recover

type Preview = { ok: boolean; mode?: { live: boolean; masterOn: boolean; optedIn: boolean }; owner?: string | null; plan?: { blockers: Array<{ id: string; text: string }>; change: Array<{ name: string; from: string }>; same: number; overCap: number; skipped: number; undoNote: string } };
type Result = { ok: boolean; message?: string; batchId?: string; undoable?: boolean; done?: number; dryRun?: number };

const SNOOZES: Array<[string, string]> = [["h4", "4 hours"], ["tomorrow", "Tomorrow"], ["d3", "3 days"], ["d7", "1 week"]];

export function RecoverTab({ location, level, accounts }: { location: string; level: "all" | "account" | "self"; accounts: number }) {
  const api = useApiClient();
  const sum = useData<CfRecoverSummary>(`cash?part=recover${location ? `&account=${encodeURIComponent(location)}` : ""}`);
  const [kind, setKind] = useState<RecoverKind | "all">("all"), [snoozed, setSnoozed] = useState(false);
  const [rows, setRows] = useState<CfRecoverRow[]>([]), [total, setTotal] = useState(0), [next, setNext] = useState<string | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState<unknown>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set()), [toast, setToast] = useState<{ text: string; undo?: string } | null>(null), [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ owner: string; ownerId: string; data: Preview } | null>(null), [ownerId, setOwnerId] = useState("");
  const q = useMemo(() => `cash?part=recover-list&kind=${kind}${snoozed ? "&snoozed=1" : ""}${location ? `&account=${encodeURIComponent(location)}` : ""}&size=25`, [kind, snoozed, location]);

  const load = useCallback(async (cursor: string | null, append: boolean) => {
    setLoading(true); setError(null);
    try {
      const r = await api.get<CfRecoverList>(`${q}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      setRows((x) => (append ? [...x, ...r.rows] : r.rows)); setTotal(r.total); setNext(r.next);
    } catch (e) { setError(e); } finally { setLoading(false); }
  }, [api, q]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPicked(new Set()); void load(null, false); }, [load]);
  const refresh = () => { sum.reload(); void load(null, false); setPicked(new Set()); };

  const chosen = rows.filter((r) => picked.has(r.key));
  const oneAccount = new Set(chosen.map((r) => r.locationId)).size === 1 ? chosen[0].locationId : null;
  const team = useData<CfTeam>(oneAccount && level !== "self" ? `cash?part=team&account=${encodeURIComponent(oneAccount)}` : null);
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const snooze = async (name: "snooze" | "unsnooze", forWhat?: string) => {
    setBusy(true);
    try { await api.post(`cash/act/${name}`, { keys: [...picked], for: forWhat }); setToast({ text: name === "snooze" ? `${picked.size} set aside. They come back by themselves.` : `${picked.size} brought back.` }); refresh(); } catch (e) { setToast({ text: failText(e) }); } finally { setBusy(false); }
  };
  const startAssign = async (who: string, label: string) => {
    setBusy(true); setToast(null);
    try { const data = await api.post<Preview>("cash/act/assign", { keys: [...picked], ownerId: who, step: "preview" }); setPreview({ owner: label, ownerId: who, data }); } catch (e) { setToast({ text: failText(e) }); } finally { setBusy(false); }
  };
  const confirmAssign = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await api.post<Result>("cash/act/assign", { keys: [...picked], ownerId: preview.ownerId, step: "do" });
      setToast({ text: r.message ?? "Done.", undo: r.undoable ? r.batchId : undefined }); setPreview(null); refresh();
    } catch (e) { setToast({ text: failText(e) }); setPreview(null); } finally { setBusy(false); }
  };
  const undo = async (batchId: string) => {
    setBusy(true);
    try { const r = await api.post<Result>("cash/act/undo", { batchId, step: "do" }); setToast({ text: r.message ?? "Put back." }); refresh(); } catch (e) { setToast({ text: failText(e) }); } finally { setBusy(false); }
  };

  const s = sum.data;
  if (sum.error && notOn(sum.error)) return <EmptyState title="Not switched on yet" body="The recovery list is not switched on for your account yet." />;
  return (
    <div className="cl-stack" data-testid="cf-recover">
      {sum.loading && !s ? <SkeletonRows rows={2} label="Finding the people to win back..." /> : sum.error ? <ErrorState error={sum.error} onRetry={sum.reload} /> : s && (
        <section className="cf-card" aria-label="Recovery summary">
          <h2 className="cl-h">Win these back</h2>
          <p className="cl-sentence" data-testid="cf-recover-headline">{s.headline}</p>
          <div className="cf-chips" role="group" aria-label="Kind of missed lead">
            <button type="button" className="cf-chip" aria-pressed={kind === "all" && !snoozed} onClick={() => { setKind("all"); setSnoozed(false); }} data-testid="cf-kind-all">All <b>{num(s.total)}</b></button>
            {RECOVER_KINDS.map((k) => <button key={k} type="button" className="cf-chip" aria-pressed={kind === k && !snoozed} title={KIND_WORDS[k].why} onClick={() => { setKind(k); setSnoozed(false); }} data-testid={`cf-kind-${k}`}>{KIND_WORDS[k].label} <b>{num(s.counts[k])}</b></button>)}
            {s.snoozed > 0 && <button type="button" className="cf-chip" aria-pressed={snoozed} onClick={() => { setKind("all"); setSnoozed(true); }} data-testid="cf-kind-snoozed">Set aside <b>{num(s.snoozed)}</b></button>}
          </div>
          <p className="ap-fine" data-testid="cf-recovered">
            {s.recovered.count > 0
              ? `Won back in the last ${s.recovered.days} days: ${num(s.recovered.count)} ${s.recovered.count === 1 ? "person" : "people"} followed up${s.recovered.value ? `, worth about ${money(s.recovered.value)} (estimate)` : ""}.`
              : s.historyStarts ? `Nobody recorded as won back yet. We have kept this record since ${s.historyStarts}.` : "We start counting who is won back at the next refresh."}
          </p>
          {s.estValue === null && s.total > 0 && <p className="ap-fine">No dollar estimate yet: not enough deal history in these accounts. The counts are real.</p>}
          <How id="recover" text={s.formula} />
        </section>
      )}

      {picked.size > 0 && (
        <div className="cf-bar" role="region" aria-label="Actions for the selected people" data-testid="cf-bar">
          <b>{picked.size} selected</b>
          {!snoozed && (
            <>
              <button type="button" className="s6-btn" data-kind="primary" disabled={busy || !oneAccount} onClick={() => void startAssign("me", "you")} data-testid="cf-give-me">Give to me</button>
              {level !== "self" && (
                <span className="cf-pick">
                  <select className="ap-field" aria-label="Give to someone" value={ownerId} disabled={!oneAccount || busy} onChange={(e) => setOwnerId(e.target.value)} data-testid="cf-owner">
                    <option value="">Give to...</option>{(team.data?.members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <button type="button" className="s6-btn" disabled={busy || !ownerId} onClick={() => void startAssign(ownerId, team.data?.members.find((m) => m.id === ownerId)?.name ?? "them")}>Preview</button>
                </span>
              )}
              <span className="cf-pick">
                <select className="ap-field" aria-label="Set aside for" defaultValue="" onChange={(e) => { if (e.target.value) { void snooze("snooze", e.target.value); e.target.value = ""; } }} disabled={busy} data-testid="cf-snooze">
                  <option value="">Set aside for...</option>{SNOOZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </span>
            </>
          )}
          {snoozed && <button type="button" className="s6-btn" disabled={busy} onClick={() => void snooze("unsnooze")}>Bring back</button>}
          <button type="button" className="ap-link" onClick={() => setPicked(new Set())}>Clear</button>
          {!oneAccount && !snoozed && <span className="ap-fine">To give people to someone, pick them from one client account at a time.</span>}
        </div>
      )}

      {preview && (
        <section className="cf-card" role="dialog" aria-label="Check before giving these people away" data-testid="cf-preview">
          <h3 className="text-base font-semibold">Give {num(preview.data.plan?.change.length ?? 0)} {(preview.data.plan?.change.length ?? 0) === 1 ? "person" : "people"} to {preview.data.owner ?? preview.owner}?</h3>
          {preview.data.plan?.blockers.map((b) => <p key={b.id} className="ap-fine" role="alert">{b.text}</p>)}
          <ul className="cf-ev">{(preview.data.plan?.change ?? []).slice(0, 10).map((c, i) => <li key={i}>{c.name}: {c.from} to {preview.data.owner ?? preview.owner}</li>)}</ul>
          {(preview.data.plan?.change.length ?? 0) > 10 && <p className="ap-fine">And {(preview.data.plan?.change.length ?? 0) - 10} more.</p>}
          {(preview.data.plan?.skipped ?? 0) > 0 && <p className="ap-fine">{preview.data.plan?.skipped} already belong to someone else, so they are left alone.</p>}
          {(preview.data.plan?.overCap ?? 0) > 0 && <p className="ap-fine">Only the first batch goes now; {preview.data.plan?.overCap} more can follow.</p>}
          {preview.data.mode && !preview.data.mode.live && <p className="ap-fine">Changes from SubSync are switched off for this account, so this will only be checked. Nothing will change in your CRM.</p>}
          <p className="ap-fine">{preview.data.plan?.undoNote} This sends nothing to the customer.</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="s6-btn" data-kind="primary" disabled={busy || (preview.data.plan?.blockers.length ?? 0) > 0 || (preview.data.plan?.change.length ?? 0) === 0} onClick={() => void confirmAssign()} data-testid="cf-confirm">Confirm</button>
            <button type="button" className="s6-btn" onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </section>
      )}
      {toast && <p className="cf-toast" role="status" data-testid="cf-toast">{toast.text}{toast.undo && <button type="button" className="ap-link" disabled={busy} onClick={() => void undo(toast.undo as string)}>Undo</button>}<button type="button" className="ap-link" onClick={() => setToast(null)}>Close</button></p>}

      {error ? <ErrorState error={error as Error} onRetry={() => void load(null, false)} /> : loading && rows.length === 0 ? <SkeletonRows rows={5} label="Loading the list..." /> : rows.length === 0 ? (
        <EmptyState title={snoozed ? "Nothing is set aside" : "Nobody is waiting to be won back"} body={snoozed ? "People you set aside appear here until they come back by themselves." : "Everyone who wrote, called or booked has had an answer. Next step: open Proof to see what was won back this week."} />
      ) : (
        <section aria-label="People to win back">
          <p className="ap-fine" data-testid="cf-total">{num(total)} in this list{accounts > 1 && !location ? " across your client accounts" : ""}. Biggest estimated value first.</p>
          <div className="ap-scroll">
            <table className="ap-t cf-t" data-testid="cf-rows">
              <thead><tr><th scope="col"><input type="checkbox" aria-label="Select everyone on this page" checked={rows.length > 0 && rows.every((r) => picked.has(r.key))} onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.key)) : new Set())} /></th><th>Person</th><th>What happened</th><th data-num>Estimated value</th><th>Owner</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} style={{ cursor: "default" }} data-testid="cf-row">
                    <td><input type="checkbox" aria-label={`Select ${r.name}`} checked={picked.has(r.key)} onChange={() => toggle(r.key)} /></td>
                    <td>{r.name}{accounts > 1 && <span className="ap-fine cf-sub">{r.accountName}</span>}</td>
                    <td><span className="ap-chip" data-tone="cyan">{r.kindLabel}</span><span className="ap-fine cf-sub">{r.detail}</span></td>
                    <td data-num>{r.estValue ? <>{money(r.estValue)}<span className="ap-fine cf-sub">Estimate{r.valueBasis === "average" ? ", account average" : ", open deal"}</span></> : <span className="ap-fine">No estimate</span>}</td>
                    <td>{r.ownerName ?? (r.ownerId ? "Someone else" : "Nobody")}</td>
                    <td className="ap-end"><OpenLeadButton seed={{ contactId: r.contactId, locationId: r.locationId, name: r.name, locationName: r.accountName, unassigned: !r.ownerId, pending: r.detail, url: r.url ?? undefined }} crmUrl={r.url} name={r.name} showAccount={accounts > 1} testId="cf-open" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="cl-pager">
            <span className="ap-fine">Showing {num(rows.length)} of {num(total)}</span>
            {next && <button type="button" className="s6-btn" disabled={loading} onClick={() => void load(next, true)} data-testid="cf-more">{loading ? "Loading..." : "Show more"}</button>}
          </div>
        </section>
      )}
      <p className="ap-fine">Missed leads are checked every hour from your own history. A person leaves this list when someone replies, calls back or books them again, and only those count as won back. Nothing here messages a lead.</p>
    </div>
  );
}

// ------------------------------------------------------------------ Pipeline: deals slipping

const KIND_CHIP: Record<CfDealRow["kind"], string> = { stale: "Gone quiet", soon: "About to go quiet", lost: "Lost" };

export function SlippingPanel({ location, showAccount }: { location: string; showAccount: boolean }) {
  const api = useApiClient();
  const loc = location ? `&account=${encodeURIComponent(location)}` : "";
  const sum = useData<CfDealsSummary>(`cash?part=deals${loc}`);
  const [kind, setKind] = useState<"slipping" | "stale" | "soon" | "lost">("slipping");
  const [rows, setRows] = useState<CfDealRow[]>([]), [total, setTotal] = useState(0), [next, setNext] = useState<string | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState<unknown>(null);
  const load = useCallback(async (cursor: string | null, append: boolean) => {
    setLoading(true); setError(null);
    try {
      const r = await api.get<CfDealsList>(`cash?part=deals-list&kind=${kind}${loc}&size=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      setRows((x) => (append ? [...x, ...r.rows] : r.rows)); setTotal(r.total); setNext(r.next);
    } catch (e) { setError(e); } finally { setLoading(false); }
  }, [api, kind, loc]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(null, false); }, [load]);
  const s = sum.data;
  if (sum.error && notOn(sum.error)) return <EmptyState title="Not switched on yet" body="Deal alerts are not switched on for your account yet." />;
  const chip = (k: typeof kind, label: string, n: number) => <button key={k} type="button" className="cf-chip" aria-pressed={kind === k} onClick={() => setKind(k)} data-testid={`cf-deals-${k}`}>{label} <b>{num(n)}</b></button>;
  return (
    <div className="cl-stack" data-testid="cf-slipping">
      {sum.loading && !s ? <SkeletonRows rows={2} label="Checking your deals..." /> : sum.error ? <ErrorState error={sum.error} onRetry={sum.reload} /> : s && (
        <section className="cf-card" aria-label="Deals slipping">
          <h2 className="cl-h">Deals slipping this week</h2>
          <p className="cl-sentence" data-testid="cf-deals-headline">{s.headline}</p>
          <div className="cf-chips" role="group" aria-label="Which deals">
            {chip("slipping", "All slipping", s.stale.count + s.soon.count)}{chip("stale", "Gone quiet", s.stale.count)}{chip("soon", "About to go quiet", s.soon.count)}{chip("lost", `Lost, last ${s.lost.days} days`, s.lost.count)}
          </div>
          <p className="ap-fine" data-testid="cf-deals-money">
            {s.stale.value !== null ? `Gone quiet: about ${money(s.stale.value)} at risk (estimate). ` : s.stale.count > 0 ? "Gone quiet: not enough valued deals for a dollar estimate. " : ""}
            {s.lost.noReason > 0 ? `${num(s.lost.noReason)} lost ${s.lost.noReason === 1 ? "deal has" : "deals have"} no reason recorded in your CRM. ` : ""}
            {s.moved.count > 0 ? `${num(s.moved.count)} flagged ${s.moved.count === 1 ? "deal has" : "deals have"} moved forward or closed in the last ${s.moved.days} days${s.moved.value ? `, about ${money(s.moved.value)} (estimate)` : ""}.` : ""}
          </p>
          <How id="deals" text={s.formula} />
        </section>
      )}
      {error ? <ErrorState error={error as Error} onRetry={() => void load(null, false)} /> : loading && rows.length === 0 ? <SkeletonRows rows={5} label="Loading the deals..." /> : rows.length === 0 ? (
        <EmptyState title="No deals here" body="No deal matches this right now. Deals are checked every hour against how long each stage normally takes in that account." />
      ) : (
        <section aria-label="Deals">
          <p className="ap-fine" data-testid="cf-deals-total">{num(total)} in this list. Biggest value first.</p>
          <div className="ap-scroll">
            <table className="ap-t cf-t" data-testid="cf-deals-rows">
              <thead><tr><th>Deal</th><th>Why</th><th data-num>Value</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} style={{ cursor: "default" }} data-testid="cf-deal-row">
                    <td>{r.name}{r.dealName && r.dealName !== r.name ? <span className="ap-fine cf-sub">{r.dealName}</span> : null}{showAccount && <span className="ap-fine cf-sub">{r.accountName}</span>}</td>
                    <td><span className="ap-chip" data-tone={r.kind === "lost" ? "amber" : "cyan"}>{KIND_CHIP[r.kind]}</span><span className="ap-fine cf-sub cf-wrap">{r.why}</span></td>
                    <td data-num>{money(r.value)}</td>
                    <td className="ap-end">
                      {r.contactId ? <OpenLeadButton seed={{ contactId: r.contactId, locationId: r.locationId, name: r.name, locationName: r.accountName, pending: r.why, tab: "deals", dealId: r.opportunityId, url: r.url ?? undefined }} crmUrl={r.url} name={r.name} showAccount={showAccount} testId="cf-deal-open" />
                        : r.url ? <a className="ap-link" href={r.url} target="_blank" rel="noopener noreferrer">Open in your CRM</a> : <span className="ap-fine">No contact on this deal</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="cl-pager"><span className="ap-fine">Showing {num(rows.length)} of {num(total)}</span>{next && <button type="button" className="s6-btn" disabled={loading} onClick={() => void load(next, true)}>{loading ? "Loading..." : "Show more"}</button>}</div>
        </section>
      )}
      <p className="ap-fine">The reason for a lost deal is shown only when your CRM recorded one. Deals are never changed from here.</p>
    </div>
  );
}

// ------------------------------------------------------------------ Settings: the morning email

export function CashSettings() {
  const api = useApiClient();
  const r = useData<CfSettings & { flags: Record<string, boolean> }>("cash?part=settings");
  const [form, setForm] = useState<{ on: boolean; hour: number; quiet: number[]; from: string; to: string; list: string } | null>(null), [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null);
  const s = r.data;
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (s && !form) setForm({ on: s.saveOn, hour: s.saveHour, quiet: s.quietDays, from: s.quietFrom === null ? "" : String(s.quietFrom), to: s.quietTo === null ? "" : String(s.quietTo), list: s.recipients.join("\n") }); }, [s, form]);
  if (r.error && notOn(r.error)) return null;
  if (!s || !form) return r.loading ? <SkeletonRows rows={2} label="Loading..." /> : null;
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await api.post("cash/act/settings", { saveOn: form.on, saveHour: form.hour, quietDays: form.quiet, quietFrom: form.from === "" ? null : Number(form.from), quietTo: form.to === "" ? null : Number(form.to), recipients: form.list.split(/[\s,;]+/).filter(Boolean) });
      setMsg("Saved."); r.reload();
    } catch (e) { setMsg(failText(e)); } finally { setBusy(false); }
  };
  const hours = [...Array(24)].map((_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>);
  return (
    <section aria-label="Morning save-this-account email" data-testid="cf-settings">
      <h2 className="cl-h mb-2">Morning email: accounts to save</h2>
      <p className="ap-fine mb-2">One email each morning listing the client accounts most at risk today, with the evidence, an estimated dollar line and one button into the right list. It sends nothing on a calm day. This email goes only to you. Your day is in {s.timezone}.</p>
      {!s.canEdit && <p className="ap-fine" role="status">Ask your administrator to change this.</p>}
      <form className="td-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><input type="checkbox" disabled={!s.canEdit} checked={form.on} onChange={(e) => setForm({ ...form, on: e.target.checked })} /> Send the morning email</label>
        <label>Send at<select className="ap-field" disabled={!s.canEdit} value={form.hour} onChange={(e) => setForm({ ...form, hour: Number(e.target.value) })}>{hours}</select></label>
        <fieldset className="td-days"><legend className="ap-fine">No email on</legend>{DAYS.map((n, i) => <label key={n}><input type="checkbox" disabled={!s.canEdit} checked={form.quiet.includes(i)} onChange={(e) => setForm({ ...form, quiet: e.target.checked ? [...form.quiet, i] : form.quiet.filter((x) => x !== i) })} /> {n}</label>)}</fieldset>
        <div className="td-days"><label>Quiet from<select className="ap-field" disabled={!s.canEdit} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })}><option value="">Never</option>{hours}</select></label><label>until<select className="ap-field" disabled={!s.canEdit} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })}><option value="">Never</option>{hours}</select></label></div>
        <label>Who gets it (one address per line)<textarea className="ap-field" rows={3} disabled={!s.canEdit} value={form.list} onChange={(e) => setForm({ ...form, list: e.target.value })} placeholder="you@yourcompany.com" /></label>
        {s.canEdit && <div className="flex flex-wrap items-center gap-3"><button type="submit" className="s6-btn" data-kind="primary" disabled={busy}>{busy ? "Saving..." : "Save"}</button>{msg && <span className="ap-fine" role="status">{msg}</span>}</div>}
      </form>
      <p className="ap-fine mt-2">{s.sendingNote} Every email has a link to stop it. You can pause one client account from the card on the Today page.</p>
    </section>
  );
}

// ------------------------------------------------------------------ Speed to lead / Unanswered: one line that leads to the win-back list

export function RecoverLink({ go }: { go: (view: "today") => void }) {
  const { flags } = useCashFlags();
  const on = flags?.cf_recover === true;
  const r = useData<CfRecoverSummary>(on ? "cash?part=recover" : null);
  if (!on || !r.data || r.data.total === 0) return null;
  const open = () => { try { window.history.replaceState(null, "", "#today?tab=recover"); } catch { /* the Today page still opens */ } go("today"); };
  return (
    <p className="cf-link ap-fine" data-testid="cf-recover-link">
      {r.data.headline} <button type="button" className="ap-link" onClick={open}>Open the win-back list</button>
    </p>
  );
}
