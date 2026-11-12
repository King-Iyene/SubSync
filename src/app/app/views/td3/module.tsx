"use client";

import { BfMini } from "../bf/bf-mini";
import { usePageRange } from "../../ds/page-range";
import { historyLimitNote } from "@/lib/design/page-range";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { AccessKind } from "@/lib/access";
import type { Td3Item, Td3List, Td3ListKind, Td3Module, Td3Numbers, Td3OpenKind, Td3Options, Td3Proof, Td3Settings, Td3Today } from "@/lib/analytics/today3-types";
import { emailText, moneyText } from "@/lib/analytics/today3-intel";
import { parseTodayAccounts, withTodayAccounts } from "@/lib/analytics/today-queue";
import { remember } from "../../ds/remember";
import { useApiClient } from "../../session";
import { EmptyState, ErrorState, ModuleTabs, SkeletonRows } from "../../ds";
import { OpenLeadButton } from "../../ds/open-lead-button";
import { InfoTip } from "../../ds/info-tip";
import { SlowRetry } from "../../ds/slow-retry";
import { Btn } from "../../ui";
import { cardLink, setDeepLink } from "@/lib/design/deep-link";
import type { GoFn, ViewId } from "../../nav";
import { TodayView } from "../today";
import { DatesBar } from "../today-dash";

import { Banknote, CalendarCheck, Gauge, Hourglass, MessageCircle, Timer } from "lucide-react";
import "../speed6.css";
import "../speed-ui.css";
import "../ap3/ap3.css";
import "../cl3/cl3.css";
import "./td3.css";
import { fixturesOn, notSwitchedOn, queryOf, useSlow, useTd } from "./data";
import { CashSettings, RecoverTab, SaveCard, useCashFlags } from "./cash";
import { FinanceTodayCard } from "../fn/today-card";
import { TodayStrip } from "./today-strip";
import { BriefCard, BriefTools, WalletCard } from "../wg/today-cards";

// Today, one screen: Today | Proof | Numbers | Settings. Today is the ranked "what to do first" list with ONE button; Proof is the weekly receipt an agency shows its client; Numbers
// replaces the old Overview (at most 6 tiles); Settings holds the daily email. Reads only: nothing here messages anyone or changes the CRM (the only writes are SubSync's own notes: a
// put-aside mark and the email choice). Every count opens exactly its rows. Sample data appears ONLY with ?tdfx=1 and is labelled "Sample data".
type TabKey = "today" | "recover" | "proof" | "numbers" | "settings";
const TIPS: Record<TabKey, [string, string]> = {
  today: ["Today", "What to do first, in one sentence and one button."], recover: ["Recover", "People who wrote, called or booked and were missed, with what they may be worth."], proof: ["Proof", "A weekly receipt you can show a client: what we found and what was fixed."],
  numbers: ["Numbers", "The few numbers that matter, each one opens the people behind it."], settings: ["Settings", "Your daily email and what you put aside."],
};
const MODULE_NAME: Record<Td3Module, string> = { speed: "Speed to lead", appointments: "Appointments", pipeline: "Pipeline and deals", clients: "Clients", team: "Team", "data-health": "Data health", settings: "Settings" };
const num = (n: number) => n.toLocaleString("en-US");
const ago = (iso: string | null): string => { if (!iso) return ""; const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000)); return h < 1 ? "just now" : h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`; };
const mins = (m: number | null) => (m === null ? "Not enough data" : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${Math.round(m / 6) / 10} h` : `${Math.round(m / 144) / 10} d`);
/** Copies text to the clipboard; where the browser refuses (some embedded frames), a hidden text box and the older copy command are the fallback. */
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const t = document.createElement("textarea");
    t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(t);
    return ok;
  } catch { return false; }
}
const subscribeTa = (cb: () => void) => { window.addEventListener("hashchange", cb); window.addEventListener("popstate", cb); window.addEventListener("subsync-today-accounts", cb); return () => { window.removeEventListener("hashchange", cb); window.removeEventListener("popstate", cb); window.removeEventListener("subsync-today-accounts", cb); }; };
/** Writes the account choice into the address (the same place the bar at the top keeps it) so the bar and this page always show the same choice. */
function writeTa(ids: string[]) {
  try { window.history.replaceState(null, "", withTodayAccounts(window.location.hash || "#today", ids)); } catch { /* the choice still applies on this page */ }
  remember("today-accounts", ids.length ? ids.join(",") : null);
  window.dispatchEvent(new Event("subsync-today-accounts"));
}
const todayText = () => { const d = new Date(); return `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()]} ${d.getDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}`; };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Drill = { title: string; kind: Td3ListKind; location: string | null; count: number } | null;
type Loaded<T> = { data: T | null; error: unknown; loading: boolean; reload: () => void };

function Load<T>({ r, children, empty }: { r: Loaded<T>; children: (d: T) => ReactNode; empty?: (d: T) => boolean | string }) {
  const slow = useSlow(r.loading && !r.data);
  if (r.loading && !r.data && slow) return <SlowRetry reload={r.reload} />;
  if (r.loading && !r.data) return <SkeletonRows rows={3} label="Working out what to do first..." />;
  if (r.error && notSwitchedOn(r.error)) return <EmptyState title="Not switched on yet" body="This part of Today is not switched on for your account yet." />;
  if (r.error) return <ErrorState error={r.error as Error} onRetry={r.reload} />;
  if (!r.data) return null;
  const e = empty?.(r.data);
  return e ? <EmptyState title="Nothing to show yet" body={typeof e === "string" ? e : "Client accounts appear here after the first sync finishes."} /> : <>{children(r.data)}</>;
}

function Pager({ page, pages, total, set }: { page: number; pages: number; total: number; set: (n: number) => void }) {
  return (
    <div className="cl-pager print:hidden" role="navigation" aria-label="Pages">
      <span className="ap-fine">{num(total)} in total</span>
      <button type="button" className="s6-btn" disabled={page <= 0} onClick={() => set(page - 1)}>Previous</button>
      <span className="ap-fine">Page {page + 1} of {Math.max(1, pages)}</span>
      <button type="button" className="s6-btn" disabled={page + 1 >= pages} onClick={() => set(page + 1)}>Next</button>
    </div>
  );
}

/** The exact rows behind a count, with "Open in your CRM". The total equals the count that opened it. */
function DrillList({ d, location, onClose }: { d: NonNullable<Drill>; location: string; onClose: () => void }) {
  const [page, setPage] = useState(0), [showLeft, setShowLeft] = useState(d.kind === "left_out");
  const head = useRef<HTMLHeadingElement>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(0); setShowLeft(d.kind === "left_out"); }, [d.kind, d.location, d.title]);
  // The list opens IN VIEW: scrolled to the top of the screen and focused (a screen reader hears the title), every time a number is chosen.
  useEffect(() => { const el = head.current; if (!el) return; el.closest("section")?.scrollIntoView({ block: "start", behavior: "smooth" }); el.focus({ preventScroll: true }); }, [d]);
  const canToggle = d.kind === "risk_all" || d.kind === "risk_stale" || d.kind === "open_deals" || d.kind === "left_out";
  const kind: Td3ListKind = showLeft ? "left_out" : d.kind;
  const r = useTd<Td3List>("list", { kind, location: d.location ?? (location || undefined), page, size: 20 });
  return (
    <section id="td-drill" className="cl-drill" data-testid="td-drill" aria-label={d.title} style={{ scrollMarginTop: 12 }}>
      <div className="mb-2 flex flex-wrap items-center gap-3"><h3 ref={head} tabIndex={-1} className="text-base font-semibold" data-testid="td-drill-title">{showLeft && d.kind !== "left_out" ? "Deals left out of the dollar figures" : d.title}</h3><span className="ap-chip" data-tone="cyan">{showLeft && d.kind !== "left_out" ? num(r.data?.total ?? 0) : num(d.count)}</span>
        {canToggle && <label className="text-sm" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={showLeft} onChange={(e) => { setShowLeft(e.target.checked); setPage(0); }} data-testid="td-drill-left-toggle" /> Show the deals left out</label>}
        <button type="button" className="ap-link ml-auto" onClick={onClose}>Close</button></div>
      <Load r={r} empty={(x) => x.rows.length === 0 && "Nothing behind this one right now."}>
        {(x) => (
          <>
            <div className="ap-scroll"><table className="ap-t" data-testid="td-drill-list"><thead><tr><th>Contact</th><th>Account</th><th>What</th><th /></tr></thead>
              <tbody>{x.rows.map((row, i) => (
                <tr key={`${row.locationId}:${row.contactId ?? i}:${i}`} style={{ cursor: "default" }}>
                  <td>{row.contactName}</td><td>{row.accountName}</td><td>{row.detail ?? ""}{row.value ? ` (${moneyText(row.value)})` : ""}</td>
                  <td className="text-right"><OpenLeadButton seed={row.contactId ? { contactId: row.contactId, locationId: row.locationId, name: row.contactName, locationName: row.accountName, url: row.url ?? undefined, note: row.detail ?? undefined } : null} crmUrl={row.url} reason="Not linked to a person in your CRM, so there is nobody to open here." name={row.contactName} showAccount={!d.location} testId="td-open-lead" /></td>
                </tr>))}</tbody></table></div>
            <Pager page={x.page} pages={x.pages} total={x.total} set={setPage} />
          </>
        )}
      </Load>
    </section>
  );
}

function useActions(reload: () => void) {
  const api = useApiClient(), sample = fixturesOn();
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState<string | null>(null);
  const act = async (name: string, body: object): Promise<boolean> => {
    if (sample) { setProblem("This is sample data, so nothing is saved."); return false; }
    setBusy(true); setProblem(null);
    try { await api.post(`today3/act/${name}`, body); reload(); return true; } catch (e) { setProblem((e as Error).message || "That did not save. Try again."); return false; } finally { setBusy(false); }
  };
  return { act, busy, problem, tap: (kind: string, location: string | null) => { if (!sample) void api.post("today3/act/opened", { kind, location: location ?? undefined }).catch(() => undefined); } };
}

/** Kinds Speed to lead already shows in full (who is waiting for a reply, with the age of each wait). Today does not list them again: the hero card "Waiting for a reply" opens Speed to lead. */
const IN_SPEED = new Set<string>(["waiting_old", "waiting"]);
/** Brief rows Speed to lead (Coverage: missed calls, nights) already covers: the "won back" row and the waiting items it replaces. */
const BRIEF_IN_SPEED = (key: string) => key === "recover" || key === "today:waiting_old" || key === "today:waiting";

type HeroCard = { id: string; label: string; value: string; note: string; tone: "red" | "amber" | "green" | "plain"; onOpen: (() => void) | null; to: string; onGo: () => void };

/** Four small number cards (none repeats what Speed to lead shows). Each opens exactly its rows (the same drill the Numbers tab uses) and says where the full list lives. Real data only: no sparkline is drawn without a record behind it. */
function Hero({ t, go, open, location }: { t: Td3Today; go: (m: Td3Module, loc?: string | null) => void; open: (d: NonNullable<Drill>) => void; location: string }) {
  const item = (k: string) => t.items.find((i) => i.kind === k) ?? null;
  const stale = item("stale_deals"), unmarked = item("unmarked");
  const noshows = item("noshows");
  // The two appointment cards count every client account with the Appointments rule (t.counts), so the number equals the rows it opens (items only list the flagged accounts, at most five kinds).
  const nUnmarked = t.counts?.unmarked ?? unmarked?.count ?? 0, nNoshows = t.counts?.noshows ?? noshows?.count ?? 0;
  const cleared = t.done.reduce((s, d) => s + d.cleared, 0);
  const since = t.historyStarts ? `History starts ${t.historyStarts}` : "No earlier record yet";
  const money = t.items.reduce((s, i) => s + (i.money ?? 0), 0);
  const loc = location || null;
  const cards: HeroCard[] = [
    { id: "money", label: "Money at risk", value: money > 0 ? moneyText(money) : "None", note: money > 0 ? `Estimate, from ${num(stale?.count ?? 0)} quiet deals` : "No deal has gone quiet", tone: money > 0 ? "red" : "green", onOpen: stale ? () => open({ title: stale.label, kind: "stale_deals", location: stale.accounts === 1 ? stale.top[0]?.locationId ?? loc : loc, count: stale.count }) : null, to: "Open Pipeline", onGo: () => { setDeepLink(cardLink("stale_deals", { count: stale?.count ?? 0, location: loc })); go("pipeline", loc); } },
    { id: "noshows", label: "No-shows to rebook", value: num(nNoshows), note: nNoshows > 0 ? "Missed in the last 7 days, not rebooked" : "Nobody to rebook", tone: nNoshows > 0 ? "amber" : "green", onOpen: nNoshows > 0 ? () => open({ title: "No-shows not booked again", kind: "open_noshows", location: loc, count: nNoshows }) : null, to: "Open Appointments", onGo: () => { setDeepLink(cardLink("noshows", { count: nNoshows, location: loc })); go("appointments", loc); } },
    { id: "appts", label: "Appointments to confirm", value: num(nUnmarked), note: nUnmarked > 0 ? "Past their time, no result marked" : "Every past appointment is marked", tone: nUnmarked > 0 ? "amber" : "green", onOpen: nUnmarked > 0 ? () => open({ title: "Appointments with no outcome marked", kind: "all_unmarked", location: loc, count: nUnmarked }) : null, to: "Open Appointments", onGo: () => { setDeepLink(cardLink("unmarked", { count: nUnmarked, location: loc })); go("appointments", loc); } },
    { id: "done", label: "Done today", value: num(cleared), note: t.historyStarts ? "Problems cleared since midnight" : since, tone: cleared > 0 ? "green" : "plain", onOpen: () => document.getElementById("td-done")?.scrollIntoView({ block: "nearest", behavior: "smooth" }), to: "Open Proof", onGo: () => undefined },
  ];
  return (
    <div className="td-hero" data-testid="td-hero" role="group" aria-label="Today at a glance">
      {cards.map((c) => (
        <div key={c.id} className="td-hcard" data-tone={c.tone} data-testid={`td-hero-${c.id}`}>
          <span className="td-hlabel">{c.label}</span>
          {c.onOpen ? <button type="button" className="td-hnum" onClick={c.onOpen} aria-label={`${c.label}: ${c.value}. Show the rows`}>{c.value}</button> : <b className="td-hnum">{c.value}</b>}
          <span className="td-hnote">{c.note}</span>
          {c.id !== "done" && <button type="button" className="ap-link td-hgo" onClick={c.onGo}>{c.to}</button>}
        </div>
      ))}
    </div>
  );
}

/** The Today tab: the slim number strip, the money cards (Finance, Wallet) and the older Today (headline, accounts, lists) exactly as it was before the rebuild. The blocks the rebuild added (the brief card, accounts to save,
 *  What to do today, In this order, Done today) are NOT drawn here; their code is kept in TodayTabBlocks below. Where each one lives now: docs/DECISIONS.md "Today, 12 Nov". */
function TodayTab({ location, level, go, open, nav, kind }: { kind: AccessKind; location: string; level: string; go: (m: Td3Module, loc?: string | null) => void; open: (d: NonNullable<Drill>) => void; nav: GoFn }) {
  const r = useTd<Td3Today>("today", { location: location || undefined });
  return (
    <div className="cl-stack td-compact" data-testid="td-today">
      <Load r={r} empty={(t) => t.accounts === 0 && "Your client accounts appear here after the first sync finishes. It takes a few minutes after install."}>
        {(t) => (
          <>
            <TodayStrip t={t} location={location} level={level as "all" | "account" | "self"} go={go} nav={nav} open={open} />
            {t.needsPermission > 0 && (
              <div className="td-note" role="status" data-testid="td-permission">
                <b>Needs permission: reconnect</b>
                <span>{t.needsPermission === 1 ? "One account" : `${t.needsPermission} accounts`} could not be fully read, so some counts may be missing.</span>
                <button type="button" className="ap-link" onClick={() => open({ title: "Accounts that need permission", kind: "needs_permission", location: null, count: t.needsPermission })}>See which</button>
              </div>
            )}
          </>
        )}
      </Load>
      {level !== "self" && <FinanceTodayCard go={nav} />}
      {level === "all" && <WalletCard go={nav} />}
      <section className="td-more-below" aria-label="More about today" data-testid="td-below">
        <h2 className="sr-only">More about today</h2>
        <TodayView go={nav} kind={kind} mode="below" />
      </section>
    </div>
  );
}

/** The blocks the rebuild added to Today, kept as they were (hidden from the page, not deleted). */
export function TodayTabBlocks({ location, level, go, open, setTab, saveOn, openRecover, nav, kind }: { kind: AccessKind; location: string; level: string; go: (m: Td3Module, loc?: string | null) => void; open: (d: NonNullable<Drill>) => void; setTab: (t: TabKey) => void; saveOn: boolean; openRecover: (loc: string) => void; nav: GoFn }) {
  const r = useTd<Td3Today>("today", { location: location || undefined });
  const { act, busy, problem, tap } = useActions(() => r.reload());
  const admin = level !== "self";
  const [all, setAll] = useState(false);
  return (
    <Load r={r} empty={(t) => t.accounts === 0 && "Your client accounts appear here after the first sync finishes. It takes a few minutes after install."}>
      {(t) => {
        const b = t.button;
        const openItem = (i: Td3Item) => { tap(i.kind, i.accounts === 1 ? i.top[0]?.locationId ?? null : null); open({ title: i.label, kind: i.kind, location: i.accounts === 1 ? i.top[0]?.locationId ?? null : null, count: i.count }); };
        const shown = t.items.filter((i) => !IN_SPEED.has(i.kind));
        const rows = all ? shown : shown.slice(0, 5);
        return (
          <div className="cl-stack td-compact" data-testid="td-today">
            <Hero t={t} go={go} open={open} location={location} />

            {t.needsPermission > 0 && (
              <div className="td-note" role="status" data-testid="td-permission">
                <b>Needs permission: reconnect</b>
                <span>{t.needsPermission === 1 ? "One account" : `${t.needsPermission} accounts`} could not be fully read, so some counts may be missing.</span>
                <button type="button" className="ap-link" onClick={() => open({ title: "Accounts that need permission", kind: "needs_permission", location: null, count: t.needsPermission })}>See which</button>
              </div>
            )}

            <div className="td-grid">
              <div className="td-col">
                {level === "all" && <BriefCard go={nav} openRecover={openRecover} hide={BRIEF_IN_SPEED} />}
                {level !== "self" && <FinanceTodayCard go={nav} />}
                {level === "all" && <WalletCard go={nav} />}
              </div>
              <div className="td-col">
                {saveOn && level !== "self" && <SaveCard openList={openRecover} go={(v, loc) => nav(v, loc)} />}
                <section className="cl-today" aria-label="What to do today">
                  <h2 className="td-h2">What to do today</h2>
                  <p className="cl-sentence" data-testid="td-sentence">{t.headline}</p>
                  <div className="td-btns">
                    {b && <button type="button" className="s6-btn" data-kind="primary" data-testid="td-go" onClick={() => { tap(b.kind, b.locationId); go(b.module, b.locationId); }}>{b.label}</button>}
                    {t.mine && t.mine.button && <button type="button" className="s6-btn" data-kind="primary" data-testid="td-mine-go" onClick={() => open({ title: t.mine?.button?.label ?? "My queue", kind: t.mine?.button?.list as Td3ListKind, location: null, count: t.mine?.button?.count ?? 0 })}>{t.mine.button.label}</button>}
                  </div>
                </section>
              </div>
            </div>

            {t.items.length === 0 && t.accounts > 0 ? (
              <section className="td-clear" data-testid="td-allclear" aria-label="All clear">
                <h2 className="td-h2">{t.needsPermission > 0 ? `Nothing urgent in what SubSync can read. Not known for ${num(t.needsPermission)} ${t.needsPermission === 1 ? "account" : "accounts"}: needs permission.` : "Nothing needs you right now."}</h2>
                <p className="ap-fine">{t.allClear && t.allClear.fixedSinceYesterday > 0 ? `${num(t.allClear.fixedSinceYesterday)} ${t.allClear.fixedSinceYesterday === 1 ? "thing was" : "things were"} fixed since yesterday${t.allClear.lastFixedAt ? `. The last one ${ago(t.allClear.lastFixedAt)}` : ""}.` : "We will tell you here the moment something needs someone."} <button type="button" className="ap-link" onClick={() => setTab("proof")}>Open Proof</button></p>
              </section>
            ) : (
              <section aria-label="Ranked list">
                <h2 className="td-h2">In this order</h2>
                <ol className="td-list" data-testid="td-items">
                  {rows.map((i, n) => (
                    <li key={i.kind} className="td-item" data-bar={i.oldestHours !== null && i.oldestHours >= 24 ? "red" : i.kind === "unmarked" || i.kind === "stale_deals" || i.kind === "noshows" ? "amber" : "grey"} data-testid={`td-item-${i.kind}`}>
                      <span className="td-rank" aria-hidden>{n + 1}</span>
                      <div className="td-main">
                        <button type="button" className="td-label" title={i.why} onClick={() => openItem(i)}>{i.label}</button>
                        <p className="ap-fine">{i.rankWhy}{i.accounts > 1 && i.top.length > 0 ? ` Most in: ${i.top.map((a) => `${a.name} (${num(a.count)})`).join(", ")}.` : ""}{i.accounts === 1 && i.top[0] && t.accounts > 1 ? ` In ${i.top[0].name}.` : ""}</p>
                      </div>
                      <div className="td-side">
                        <button type="button" className="s6-btn" data-kind="primary" onClick={() => { tap(i.kind, null); go(i.module, i.accounts === 1 ? i.top[0]?.locationId ?? null : null); }}>Open in {MODULE_NAME[i.module]}</button>
                        {admin && <button type="button" className="ap-link" disabled={busy} onClick={() => void act("snooze", { kind: i.kind, days: 1 })}>Put aside</button>}
                      </div>
                    </li>
                  ))}
                </ol>
                {shown.length > 5 && <button type="button" className="ap-link" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show ${shown.length - 5} more`}</button>}
              </section>
            )}
            {problem && <p className="ap-fine" role="alert">{problem}</p>}

            <div className="td-grid">
              {t.snoozed.length > 0 && (
                <section aria-label="Put aside">
                  <h2 className="td-h2">Put aside for now</h2>
                  <ul className="cl-steps" data-testid="td-snoozed">{t.snoozed.map((s) => <li key={s.id}><b>{s.label}</b><span>until {new Date(s.until).toISOString().slice(0, 10)}</span><button type="button" className="ap-link" disabled={busy} onClick={() => void act("unsnooze", { id: s.id })}>Bring back</button></li>)}</ul>
                </section>
              )}
              <section id="td-done" aria-label="Done today">
                <h2 className="td-h2">Done today</h2>
                {t.done.length > 0
                  ? <ul className="td-done" data-testid="td-done">{t.done.map((d) => <li key={d.kind}><b>{num(d.cleared)}</b> cleared: {d.label}{d.lastAt ? ` (last ${ago(d.lastAt)})` : ""}</li>)}</ul>
                  : <p className="ap-fine" data-testid="td-done-empty">{t.historyStarts ? "Nothing cleared yet today." : "We start keeping this record at the next refresh."}</p>}
              </section>
            </div>

            <details className="td-about" data-testid="td-about">
              <summary>About these numbers</summary>
              <p className="ap-fine">{t.scope}. {t.historyStarts ? `Our record of what was found and fixed starts ${t.historyStarts}.` : "Our record of what was found and fixed has not started yet."} Counts here equal the same counts in each screen. Nothing on this page changes your CRM or messages your leads. Who is waiting for a reply, and the missed calls and nights nobody answered, are in Speed to lead.</p>
            </details>
            <section className="td-more-below" aria-label="More about today" data-testid="td-below">
              <h2 className="sr-only">More about today</h2>
              <TodayView go={nav} kind={kind} mode="below" />
            </section>
          </div>
        );
      }}
    </Load>
  );
}

const RECORD_TIP = "Counted from our daily record: SubSync keeps the total, not the people.";
const PAST_TIP = "This is the total counted at the end of that week. The people are not kept for past weeks, only for the current one.";
/** A figure that is only a total: plain text with an "i", never an underlined link. */
function TotalNum({ value, tip }: { value: string; tip: string }) {
  return <span className="td-total" data-total="true"><span className="td-totalnum">{value}</span><InfoTip text={tip} label="Why this does not open a list" /></span>;
}
type ProofPanel = { title: string; location: string | null; kinds: Td3OpenKind[] } | null;

function ProofTab({ location, accounts, open }: { location: string; accounts: boolean; open: (d: NonNullable<Drill>) => void }) {
  const api = useApiClient(), sample = fixturesOn();
  const [week, setWeek] = useState(""), [page, setPage] = useState(0), [copied, setCopied] = useState(false), [panel, setPanel] = useState<ProofPanel>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(0); setPanel(null); }, [week, location]);
  // One kind opens its rows at once; several kinds first show each kind with its count, and each of those opens its rows.
  const openKinds = (title: string, loc: string | null, kinds: Td3OpenKind[]) => {
    if (kinds.length === 1) { setPanel(null); open({ title: `${title}: ${kinds[0].label}`, kind: kinds[0].kind, location: loc, count: kinds[0].count }); } else setPanel({ title, location: loc, kinds });
  };
  const r = useTd<Td3Proof>("proof", { location: location || undefined, week: week || undefined, page, size: 20 });
  return (
    <Load r={r}>
      {(p) => {
        const text = [`${p.accountName ?? "Your client accounts"}: week of ${p.weekStart}`, ...p.lines, ...p.clientLines].join("\n");
        return (
          <div className="cl-stack td-compact" data-testid="td-proof">
            <div className="ap-head print:hidden" role="group" aria-label="Choose a week">
              <select className="ap-field" aria-label="Week" value={week || p.weekStart} onChange={(e) => setWeek(e.target.value)}>{p.weeks.map((w) => <option key={w} value={w}>Week starting {w}</option>)}</select>
              {!sample && <Btn onClick={() => api.download(queryOf("export", { week: p.weekStart, location: location || undefined }), "proof.csv")}>Download CSV</Btn>}
              <Btn onClick={() => window.print()}>Print</Btn>
            </div>
            <section className="td-receipt" aria-label="Weekly receipt" data-testid="td-receipt">
              <h2 className="td-h2">Weekly receipt: week of {p.weekStart}{p.accountName ? `, ${p.accountName}` : ""}</h2>
              {p.total.enough ? (
                <div className="td-big">
                  <div><b><TotalNum value={num(p.total.found)} tip={RECORD_TIP} /></b><span title="Problems that appeared this week and needed someone">Found</span></div>
                  <div><b><TotalNum value={num(p.total.cleared)} tip={RECORD_TIP} /></b><span title="Problems that were cleared this week">Fixed</span></div>
                  <div>
                    <b>{p.isCurrent && p.total.stillOpen > 0 && p.total.openByKind.length > 0
                      ? <button type="button" className="td-hnum" data-testid="td-proof-open" onClick={() => openKinds("Still open", location || null, p.total.openByKind)} aria-label={`Still open: ${num(p.total.stillOpen)}. Show the rows`}>{num(p.total.stillOpen)}</button>
                      : p.total.stillOpen > 0 ? <TotalNum value={num(p.total.stillOpen)} tip={p.isCurrent ? RECORD_TIP : PAST_TIP} /> : <span className="td-totalnum">{num(p.total.stillOpen)}</span>}</b>
                    <span>Still open</span>
                  </div>
                  <div><b>{mins(p.total.medianFixMinutes)}</b><span title="The middle time between a problem appearing and being cleared. Needs 3 fixes.">Usual time to fix</span></div>
                </div>
              ) : null}
              <ul className="td-lines" data-testid="td-lines">{[...p.lines, ...p.clientLines].map((l, i) => <li key={i}>{l}</li>)}</ul>
              <div className="flex flex-wrap gap-3 print:hidden">
                <button type="button" className="s6-btn" data-kind="primary" data-testid="td-copy" onClick={() => { void copyText(text).then(setCopied); }}>{copied ? "Copied" : "Copy client report"}</button>
                {p.isCurrent && p.total.stillOpen > 0 && p.total.openByKind.length > 0 && <button type="button" className="ap-link" data-testid="td-proof-open-link" onClick={() => openKinds("Still open", location || null, p.total.openByKind)}>See the {num(p.total.stillOpen)} still open</button>}
                {!p.isCurrent && p.total.stillOpen > 0 && <span className="ap-fine">{num(p.total.stillOpen)} were still open at the end of this week. Pick the newest week to see who is open now.</span>}
              </div>
              {panel && (
                <div className="td-openpanel" data-testid="td-proof-panel" role="group" aria-label={panel.title}>
                  <b>{panel.title}{panel.location ? `: ${accounts ? p.rows.rows.find((x) => x.locationId === panel.location)?.name ?? "this account" : "your account"}` : ""}</b>
                  <ul className="cl-steps">{panel.kinds.map((k) => <li key={k.kind}><button type="button" className="td-cellnum" data-testid="td-proof-kind" onClick={() => open({ title: `${panel.title}: ${k.label}`, kind: k.kind, location: panel.location, count: k.count })} aria-label={`${num(k.count)} ${k.label}. Show the rows`}>{num(k.count)}</button><span>{k.label}</span></li>)}</ul>
                </div>
              )}
              <p className="ap-fine">{p.historyStarts ? `Found and fixed come from our own daily record, which starts ${p.historyStarts}. SubSync keeps those as totals, not the people, so they show an "i" instead of opening a list. Still open for the newest week opens the people.` :"Our daily record has not started yet."} A problem counts as fixed only when the next refresh shows it cleared.</p>
            </section>
            {p.byKind.length > 0 && <section aria-label="What we found"><h2 className="td-h2">What we caught</h2><ul className="cl-steps" data-testid="td-caught">{p.byKind.map((k) => {
              const canOpen = p.isCurrent && k.stillOpen > 0;
              const row = <><b><TotalNum value={num(k.found)} tip={RECORD_TIP} /></b><span>{k.label}</span><span>{num(k.cleared)} fixed</span>{k.stillOpen > 0 && <span>{num(k.stillOpen)} still open</span>}</>;
              return canOpen
                ? <li key={k.kind}><button type="button" className="td-caughtrow" data-testid="td-caught-open" aria-label={`${num(k.stillOpen)} ${k.label} still open. Show the rows`} onClick={() => open({ title: `Still open: ${k.label}`, kind: k.kind, location: location || null, count: k.stillOpen })}>{row}<span className="td-caughtgo">Show who</span></button></li>
                : <li key={k.kind}>{row}</li>;
            })}</ul></section>}
            {accounts && p.rows.rows.length > 0 && (
              <section aria-label="By account">
                <h2 className="td-h2">By client account</h2>
                <div className="ap-scroll"><table className="ap-t" data-testid="td-proof-table"><thead><tr><th>Account</th><th data-num>Found</th><th data-num>Fixed</th><th data-num>Still open</th><th data-num>Usual time to fix</th></tr></thead>
                  <tbody>{p.rows.rows.map((x) => <tr key={x.locationId} style={{ cursor: "default" }}><td>{x.name}</td><td data-num><TotalNum value={num(x.found)} tip={RECORD_TIP} /></td><td data-num><TotalNum value={num(x.cleared)} tip={RECORD_TIP} /></td><td data-num>{p.isCurrent && x.stillOpen > 0 && x.openByKind.length > 0 ? <button type="button" className="td-cellnum" data-testid="td-proof-account-open" aria-label={`${x.name}: ${num(x.stillOpen)} still open. Show the rows`} onClick={() => openKinds(`Still open in ${x.name}`, x.locationId, x.openByKind)}>{num(x.stillOpen)}</button> : x.stillOpen > 0 ? <TotalNum value={num(x.stillOpen)} tip={p.isCurrent ? RECORD_TIP : PAST_TIP} /> : <span className="td-totalnum">{num(x.stillOpen)}</span>}</td><td data-num>{mins(x.medianFixMinutes)}</td></tr>)}</tbody></table></div>
                <Pager page={p.rows.page} pages={p.rows.pages} total={p.rows.total} set={setPage} />
              </section>
            )}
          </div>
        );
      }}
    </Load>
  );
}

const TILE_ICON: Record<string, ReactNode> = {
  reply: <Timer className="size-3.5" />, waiting: <MessageCircle className="size-3.5" />, showrate: <CalendarCheck className="size-3.5" />,
  open_deals: <Banknote className="size-3.5" />, stale: <Hourglass className="size-3.5" />, attention: <Gauge className="size-3.5" />,
};

/** Numbers: the headline row (six numbers, each opens its rows) and under it the whole dashboard of charts, one bar of dates for all of them. */
function NumbersTab({ location, go, open, fromOverview, level, nav, kind }: { location: string; go: (m: Td3Module, loc?: string | null) => void; open: (d: NonNullable<Drill>) => void; fromOverview: boolean; level: string; nav: GoFn; kind: AccessKind }) {
  const bar = usePageRange(), [how, setHow] = useState<string | null>(null);
  // The dates are the date bar's (one range for the whole app): the numbers below are for exactly the dates in the bar.
  const r = useTd<Td3Numbers>("numbers", { location: location || undefined, from: bar.from || undefined, to: bar.to || undefined }, !bar.ready);
  return (
    <div className="cl-stack td-compact" data-testid="td-numbers">
      {fromOverview && <p className="ap-fine" role="status" data-testid="td-moved">Overview moved here. Its numbers are in the row below and its account list is at the bottom of this page.</p>}
      {level !== "self" && <DatesBar />}
      <Load r={r} empty={(n) => n.tiles.length === 0}>
        {(n) => (
          <>
            {bar.ready && <BfMini location={location} from={bar.from} to={bar.to} go={nav} />}
            <div className="td-tiles" data-testid="td-tiles">
              {n.tiles.map((t) => (
                <div key={t.id} className="td-tile" data-testid={`td-tile-${t.id}`}>
                  <div className="td-top"><span className="td-ico" aria-hidden>{TILE_ICON[t.id]}</span><span className="td-name">{t.label}</span></div>
                  <button type="button" className="td-open" disabled={!t.enough && !("module" in t.opens)} onClick={() => { if ("list" in t.opens) open({ title: t.label, kind: t.opens.list, location: location || null, count: t.count }); else go(t.opens.module, location || null); }}>
                    <b>{t.value}</b>
                  </button>
                  {t.change && <span><span className="td-chg">{t.change} vs before</span></span>}
                  {t.caption && <span className="td-cap" data-testid={`td-caption-${t.id}`}>{t.caption}</span>}
                  {t.estimate && <span><span className="ap-chip" data-tone="cyan">Estimate</span></span>}
                  <button type="button" className="ap-link" style={{ textAlign: "left" }} aria-expanded={how === t.id} onClick={() => setHow(how === t.id ? null : t.id)}>How is this worked out?</button>
                  {how === t.id && <p className="ap-fine" data-testid={`td-formula-${t.id}`}>{t.formula}</p>}
                </div>
              ))}
            </div>
            {n.testDealsLeftOut > 0 && <p className="ap-fine">{num(n.testDealsLeftOut)} open deals with no value or no owner are left out of the dollar figure (usually test or junk deals).</p>}
            <p className="ap-fine">{n.historyStarts ? `Our own record starts ${n.historyStarts}.` : "Our own record has not started yet, so there are no trends to show."}{bar.resolved && historyLimitNote(n.historyStarts, bar.resolved) ? ` ${historyLimitNote(n.historyStarts, bar.resolved)}` : ""}</p>
          </>
        )}
      </Load>
      <TodayView go={nav} kind={kind} mode="dashboard" />
    </div>
  );
}

function SettingsTab({ level, cashOn, saveOn, nav }: { level: string; cashOn: boolean; saveOn: boolean; nav: GoFn }) {
  const r = useTd<Td3Settings>("settings");
  const today = useTd<Td3Today>("today");
  const { act, busy, problem } = useActions(() => r.reload());
  type Form = { on: boolean; hour: number; quiet: number[]; list: string };
  const [form, setFormRaw] = useState<Form | null>(null), [saved, setSaved] = useState<number | null>(null);
  const s = r.data;
  // Any edit clears the "Saved" mark, so it never claims more than what was saved.
  const setForm = (f: Form) => { setSaved(null); setFormRaw(f); };
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (s && !form) setFormRaw({ on: s.emailOn, hour: s.emailHour, quiet: s.quietDays, list: s.recipients.join("\n") }); }, [s, form]);
  // After a save the page asks again and shows what the server now holds, so what is on screen is always what is stored.
  const resync = (d: Td3Settings) => setFormRaw({ on: d.emailOn, hour: d.emailHour, quiet: d.quietDays, list: d.recipients.join("\n") });
  useEffect(() => { if (saved === null) return; const t = setTimeout(() => setSaved(null), 6000); return () => clearTimeout(t); }, [saved]);
  const save = async (d: Td3Settings, f: Form) => {
    const ok = await act("settings", { emailOn: f.on, emailHour: f.hour, quietDays: f.quiet, recipients: f.list.split(/[\s,;]+/).filter(Boolean) });
    if (ok) { setSaved((n) => (n ?? 0) + 1); resync({ ...d, emailOn: f.on, emailHour: f.hour, quietDays: f.quiet, recipients: f.list.split(/[\s,;]+/).filter(Boolean) }); }
  };
  return (
    <Load r={r}>
      {(d) => form && (
        <div className="cl-stack td-compact td-settings" data-testid="td-settings">
          <div className="td-glance" data-testid="td-settings-glance" style={{ gridColumn: "1 / -1", display: "flex", flexWrap: "wrap", gap: 8 }} aria-label="Your settings at a glance">
            <span className="ap-chip" data-tone={form.on ? "green" : "amber"}>Daily email: {form.on ? `on, ${String(form.hour).padStart(2, "0")}:00` : "off"}</span>
            <span className="ap-chip" data-tone="cyan">{form.list.split(/[\s,;]+/).filter(Boolean).length} {form.list.split(/[\s,;]+/).filter(Boolean).length === 1 ? "person gets it" : "people get it"}</span>
            {today.data && <span className="ap-chip" data-tone="plain">{today.data.snoozed.length} put aside</span>}
            {saved !== null && <span className="ap-chip" data-tone="green" role="status" data-testid="td-saved">Saved. Your changes are live.</span>}
          </div>
          <section className="td-card2" aria-label="Daily email">
            <h2 className="td-h2">Daily email</h2>
            <p className="ap-fine mb-2">One short email a day with the same ranked list as Today and one link. It never messages your leads. Your day is in {d.timezone}.</p>
            {!d.canEdit && <p className="ap-fine" role="status">Ask your administrator to change this.</p>}
            <form className="td-form" onSubmit={(e) => { e.preventDefault(); void save(d, form); }}>
              <label className="flex-row items-center gap-2" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><input type="checkbox" disabled={!d.canEdit} checked={form.on} onChange={(e) => setForm({ ...form, on: e.target.checked })} /> Send me the daily email</label>
              <label>Send at<select className="ap-field" disabled={!d.canEdit} value={form.hour} onChange={(e) => setForm({ ...form, hour: Number(e.target.value) })}>{[...Array(24)].map((_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select></label>
              <fieldset className="td-days"><legend className="ap-fine">No email on</legend>{DAYS.map((n, i) => <label key={n}><input type="checkbox" disabled={!d.canEdit} checked={form.quiet.includes(i)} onChange={(e) => setForm({ ...form, quiet: e.target.checked ? [...form.quiet, i] : form.quiet.filter((x) => x !== i) })} /> {n}</label>)}</fieldset>
              <label>Who gets it (one address per line, one email per person)<textarea className="ap-field" rows={3} disabled={!d.canEdit} value={form.list} onChange={(e) => setForm({ ...form, list: e.target.value })} placeholder="you@yourcompany.com" /></label>
              {d.canEdit && <div className="flex flex-wrap items-center gap-3"><button type="submit" className="s6-btn" data-kind="primary" disabled={busy}>{busy ? "Saving..." : saved !== null ? "Saved" : "Save"}</button>{saved !== null && !problem && <span className="ap-fine" role="status">Saved just now.</span>}</div>}
              {problem && <p className="ap-fine" role="alert">{problem}</p>}
            </form>
            <p className="ap-fine mt-2">Emails go out only once sending is switched on for your business. Until then this page shows exactly what would be sent. Every email has a link to stop it.</p>
          </section>
          {today.data && (
            <section className="td-card2" aria-label="Preview">
              <h2 className="td-h2">What today&apos;s email would say</h2>
              <pre className="td-preview" data-testid="td-preview">{(() => { const m = emailText(today.data, "(link to your Today page)", "(link to stop these emails)"); return `Subject: ${m.subject}\n\n${m.text}`; })()}</pre>
            </section>
          )}
          {level === "all" && <div className="td-card2"><BriefTools /></div>}
          {saveOn && level !== "self" && <details className="td-card2" data-testid="td-settings-save"><summary className="td-h2">Accounts to save (the list and the paused ones)</summary><SaveCard openList={(loc) => nav("speed", loc || undefined)} go={(v, loc) => nav(v, loc)} /></details>}
          {cashOn && level !== "self" && <div className="td-card2"><CashSettings /></div>}
          {level !== "self" && today.data && (
            <section className="td-card2" aria-label="Put aside" data-testid="td-settings-aside">
              <h2 className="td-h2">Put aside</h2>
              {today.data.snoozed.length === 0
                ? <p className="ap-fine">Nothing is put aside. Use Put aside on the Today list and it waits here until it comes back by itself.</p>
                : <ul className="cl-steps">{today.data.snoozed.map((x) => <li key={x.id}><b>{x.label}</b><span>until {new Date(x.until).toISOString().slice(0, 10)}</span><button type="button" className="ap-link" disabled={busy} onClick={() => void act("unsnooze", { id: x.id }).then(() => today.reload())}>Bring back</button></li>)}</ul>}
            </section>
          )}
          {level !== "self" && <p className="ap-fine">Things you put aside on the Today page come back by themselves after the days you chose, and you can bring them back sooner there.</p>}
        </div>
      )}
    </Load>
  );
}

const VIEW_OF: Record<Td3Module, ViewId> = { speed: "speed", appointments: "appointments", pipeline: "pipeline", clients: "clients", team: "team", "data-health": "data-health", settings: "settings" };

export function TodayModule({ go, kind, initialTab = "today", fromOverview = false }: { go: GoFn; kind: AccessKind; initialTab?: TabKey; fromOverview?: boolean }) {
  const sample = fixturesOn();
  const opt = useTd<Td3Options>("options");
  const level = (opt.data?.level ?? "all") as "all" | "account" | "self";
  const cash = useCashFlags();
  const link = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const [tab, setTab] = useState<TabKey>(() => initialTab), [location, setLocation] = useState(() => (/^[A-Za-z0-9_-]{3,64}$/.test(link.get("account") ?? "") ? (link.get("account") as string) : "")), [drill, setDrill] = useState<Drill>(null);
  const ta = parseTodayAccounts(useSyncExternalStore(subscribeTa, () => window.location.hash, () => "")), taKey = ta.join(","), taSeen = useRef(false);
  // The account choice in the bar at the top and the one on this page are one choice: one account narrows every number here; several are counted as all, and the page says so.
  useEffect(() => { if (taKey || taSeen.current) setLocation(taKey && !taKey.includes(",") ? taKey : ""); taSeen.current = taKey !== ""; }, [taKey]);
  const flags = opt.data?.flags ?? null;
  const flagOf: Record<TabKey, string | null> = { today: "td_today", recover: null, proof: "td_proof", numbers: "td_numbers", settings: null };
  const saveOn = cash.flags?.cf_save === true, cashMail = saveOn || cash.flags?.cf_email === true;
  const tabs = useMemo(() => (["today", "proof", "numbers", "settings"] as TabKey[]).filter((k) => (k !== "settings" || level !== "self") && (!flagOf[k] || flags === null || flags[flagOf[k] as string] !== false)), [flags, level]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = tabs.includes(tab) ? tab : tabs[0];
  const accounts = opt.data?.accounts ?? [];
  // A business or a client's staff have no Clients, Settings or Team-wide pages of the owner's kind: the closest page of their own is used instead.
  const goModule = (m: Td3Module, loc?: string | null) => {
    const view: ViewId = level !== "all" && m === "clients" ? "overview" : level === "self" && m === "settings" ? "help" : VIEW_OF[m];
    go(view, loc ?? undefined);
  };
  // The list scrolls itself into view and takes focus when it appears (DrillList), so choosing a number always shows its rows.
  const open = (d: NonNullable<Drill>) => { setDrill(d); };
  const goTab = (t: TabKey) => { setTab(t); setDrill(null); };
  if (!sample && opt.data && opt.data.canSee === false) return <div data-testid="page" className="td-page"><header className="td-head"><h1>Today</h1></header></div>;
  const body = (() => {
    switch (active) {
      case "today": return <TodayTab location={location} level={level} go={goModule} open={open} nav={go} kind={kind} />;
      case "recover": return <RecoverTab location={location} level={level} accounts={accounts.length} />;
      case "proof": return <ProofTab location={location} accounts={level !== "self"} open={open} />;
      case "numbers": return <NumbersTab location={location} go={goModule} open={open} fromOverview={fromOverview} level={level} nav={go} kind={kind} />;
      case "settings": return <SettingsTab level={level} cashOn={cashMail} saveOn={saveOn} nav={go} />;
    }
  })();
  return (
    <div className="s6 ap cl td ds-enter" data-testid="td-module">
      <div data-testid="page" className="td-page"><header className="td-head"><h1>Today</h1><span>{todayText()}</span></header>
        {sample && <p className="ap-fine mb-2" role="status" data-testid="td-sample">Sample data: these are not your real clients.</p>}
        {opt.data?.problem && <p className="ap-fine mb-2" role="status">{opt.data.problem}</p>}
        <ModuleTabs pill label="Today sections" tabs={tabs.map((k) => ({ label: TIPS[k][0], tip: TIPS[k][1], node: null }))} value={Math.max(0, tabs.indexOf(active))} onChange={(i) => goTab(tabs[i])} />
        {level !== "self" && accounts.length > 1 && active !== "settings" && (kind !== "agency" || ta.length > 1) && (
          // The account choice follows into Recover too, so a button from the morning email lands on the right account.
          <div className="ap-head print:hidden" role="group" aria-label="Filters">
            {kind !== "agency" && <select className="ap-field" aria-label="Client account" value={location} onChange={(e) => { setLocation(e.target.value); setDrill(null); writeTa(e.target.value ? [e.target.value] : []); }} data-testid="td-account"><option value="">All client accounts</option>{accounts.map((a) => <option key={a.locationId} value={a.locationId}>{a.name}</option>)}</select>}
            {(kind !== "agency" || ta.length > 1) && <span className="ap-fine">{ta.length > 1 ? `The bar above has ${ta.length} client accounts chosen. Today shows one at a time, so the numbers below count every client account.` : "Every number below follows this choice."}</span>}
          </div>
        )}
        <div data-testid={`td-tab-${active}`}>{body}</div>
        {drill && active !== "settings" && <DrillList d={drill} location={location} onClose={() => setDrill(null)} />}
      </div>
    </div>
  );
}
