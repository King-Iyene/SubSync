"use client";

import { useEffect, useState } from "react";
import type { Cl3Billing, Cl3BillingList, Cl3Compare, Cl3Options, Cl3People, Cl3Receipt, Cl3ReceiptList, Cl3SetupList, Cl3Trends } from "@/lib/analytics/clients3-types";
import { EmptyState } from "../../ds";
import { RoleChip } from "../../roles";
import { useCl, type ClParams } from "./data";
import { AccountSettings } from "./settings";
import { ago, change, day, Find, LevelChip, Load, minutes, money, NOT_ENOUGH, NOT_FROM_PLATFORM, Pager, RECONNECT, Spark } from "./shared";

// The sections of the Clients screen that read their own part: Trends, Compare accounts, Reports, People, Setup health (with the plan and subscription list). Reads only, except the settings
// panel opened from Reports. Every figure is a count from synced data; anything under its minimum says "Not enough data".
type Shared = { filters: ClParams };

/** A paged list with a debounced search; any change of search or filters returns to the first page (pages count from 0, as the API does). */
function useList(extra: ClParams) {
  const [q, setQ] = useState(""), [dq, setDq] = useState(""), [page, setPage] = useState(0);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(0); }, 300); return () => clearTimeout(t); }, [q]);
  const key = JSON.stringify(extra);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(0); }, [key]);
  return { q, setQ, dq, page, setPage, params: { q: dq, page, size: 20, ...extra } as ClParams };
}

export function Trends({ filters }: Shared) {
  const [grain, setGrain] = useState<"week" | "month">("week");
  const l = useList({ ...filters, grain });
  const r = useCl<Cl3Trends>("trends", l.params);
  return (
    <div data-testid="cl-trends">
      <Find q={l.q} setQ={l.setQ}>
        <select className="ap-field" aria-label="Group by" value={grain} onChange={(e) => setGrain(e.target.value === "month" ? "month" : "week")}><option value="week">Week on week</option><option value="month">Month on month</option></select>
      </Find>
      <Load r={r} empty={(t) => t.rows.rows.length === 0 && t.points.length === 0}>
        {(t) => (
          <>
            <p className="ap-fine mb-3">From our own record{t.historyStarts ? `, which starts ${t.historyStarts}` : ""}. A change is shown only when the earlier period had enough to compare.</p>
            {t.points.length > 2 && (
              <div className="cl-tiles mb-4">
                {([["New leads", t.points.map((p) => p.newLeads)], ["Appointments booked", t.points.map((p) => p.booked)], ["Money won", t.points.map((p) => p.wonValue)]] as Array<[string, number[]]>).map(([label, v]) => (
                  <div key={label} className="cl-tile" style={{ cursor: "default" }}><b>{label === "Money won" ? money(v[v.length - 1]) : v[v.length - 1].toLocaleString("en-US")}</b><span>{label}, all accounts</span><Spark values={v} label={`${label} by ${grain}`} /></div>
                ))}
              </div>
            )}
            <div className="ap-scroll"><table className="ap-t"><thead><tr><th>Account</th><th>New leads</th><th>Booked</th><th>Money won</th><th>Staff messages</th></tr></thead>
              <tbody>{t.rows.rows.map((x) => (
                <tr key={x.locationId} style={{ cursor: "default" }}><td><span className="ap-name">{x.name}</span></td>
                  <td><span className="cl-cell"><Spark values={x.spark} label={`${x.name} new leads`} /><span>{x.newLeads.current} <span className="ap-sub">{change(x.newLeads) ?? ""}</span></span></span></td>
                  <td>{x.booked.current} <span className="ap-sub">{change(x.booked) ?? ""}</span></td><td>{money(x.wonValue.current)} <span className="ap-sub">{change(x.wonValue) ?? ""}</span></td><td>{x.staffMessages.current} <span className="ap-sub">{change(x.staffMessages) ?? ""}</span></td></tr>
              ))}</tbody></table></div>
            <Pager page={t.rows.page} pages={t.rows.pages} total={t.rows.total} set={l.setPage} />
          </>
        )}
      </Load>
    </div>
  );
}

type Side = Cl3Compare["sides"][number];
type CmpLine = [label: string, get: (s: Side) => number | null, fmt: (n: number) => string, higherBetter: boolean];
const pct = (n: number) => `${Math.round(n * 100)}%`;
const CMP_GROUPS: Array<[string, CmpLine[]]> = [
  ["Leads and replies", [["New leads", (s) => s.newLeads, String, true], ["Waiting for a reply", (s) => s.waiting, String, false], ["Median first reply", (s) => s.medianReplyMinutes, (n) => minutes(n), false]]],
  ["Appointments", [["Booked", (s) => s.booked, String, true], ["Show rate", (s) => s.showRate.value, pct, true]]],
  ["Deals and money", [["Money won", (s) => s.wonValue, money, true], ["Open deal value", (s) => s.openValue, money, true], ["Stuck deals", (s) => s.staleDealsPct.value, pct, false]]],
  ["Team and data", [["Staff messages", (s) => s.staffMessages, String, true], ["Contacts with no owner", (s) => s.noOwnerPct.value, pct, false]]],
];

/** A searchable account picker (works for 50+ accounts): type to filter, pick from the list. */
function AccountPick({ label, value, accounts, onPick }: { label: string; value: string; accounts: Array<{ locationId: string; name: string }>; onPick: (id: string) => void }) {
  const current = accounts.find((x) => x.locationId === value)?.name ?? "";
  const [text, setText] = useState(current);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setText(current); }, [current]);
  const listId = `cl-cmp-${label.replace(/\W/g, "")}`;
  return (
    <label className="ap-search" style={{ minWidth: 200 }}><span className="sr-only">{label}</span>
      <input list={listId} value={text} placeholder={label} aria-label={label} data-testid={`cl-pick-${label.split(" ")[0].toLowerCase()}`}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => { setText(e.target.value); const hit = accounts.find((x) => x.name === e.target.value); if (hit) onPick(hit.locationId); }} />
      <datalist id={listId}>{accounts.map((x) => <option key={x.locationId} value={x.name} />)}</datalist>
    </label>
  );
}

export function Compare({ options, filters }: { options: Cl3Options | null; filters: ClParams }) {
  const accts = options?.accounts ?? [];
  const [a, setA] = useState(""), [b, setB] = useState("");
  const A = a || accts[0]?.locationId || "", B = b || accts[1]?.locationId || "";
  const r = useCl<Cl3Compare>("compare", { ...filters, ids: A && B ? `${A},${B}` : undefined }, !(A && B));
  if (accts.length < 2) return <EmptyState title="Compare needs two client accounts" body="Once at least two client accounts have synced, you can put them side by side here." />;
  return (
    <div data-testid="cl-compare">
      <div className="ap-head print:hidden"><AccountPick label="First account" value={A} accounts={accts} onPick={setA} /><span className="ap-fine">against</span><AccountPick label="Second account" value={B} accounts={accts} onPick={setB} /></div>
      <Load r={r} empty={(c) => c.sides.length < 2 && "Pick two different accounts."}>
        {(c) => {
          const [x, y] = c.sides;
          // Only rows where at least one account has a value; the better value (when both have one and they differ) is marked.
          const groups = CMP_GROUPS.map(([title, lines]) => [title, lines.flatMap(([label, get, fmt, high]) => {
            const v = [get(x), get(y)] as [number | null, number | null];
            if (v[0] === null && v[1] === null) return [];
            const win = v[0] === null || v[1] === null || v[0] === v[1] ? -1 : (v[0] > v[1]) === high ? 0 : 1;
            return [{ label, text: v.map((n) => (n === null ? "No data" : fmt(n))) as [string, string], win }];
          })] as const).filter(([, rows]) => rows.length > 0);
          const better = [0, 0];
          for (const [, rows] of groups) for (const r2 of rows) if (r2.win >= 0) better[r2.win]++;
          const lead = better[0] === better[1] ? null : better[0] > better[1] ? 0 : 1;
          const sentence = groups.length === 0 ? "Neither account has enough data to compare yet." : lead === null ? `${x.name} and ${y.name} are level on the numbers that differ.` : `${c.sides[lead].name} is ahead on ${better[lead]} of ${better[0] + better[1]} measures that differ.`;
          return (
            <div className="cl-cmp" data-testid="cl-cmp-cards">
              <p className="cl-cmp-sum" data-testid="cl-cmp-summary">{sentence}</p>
              <div className="cl-cmp-grid">
                {[x, y].map((s, i) => (
                  <section key={s.locationId} className="cl-cmp-card" aria-label={s.name}>
                    <header><b>{s.name}</b><LevelChip level={s.level} /></header>
                    {groups.map(([title, rows], gi) => (
                      <details key={title} open={gi === 0}><summary>{title}</summary>
                        <dl>{rows.map((row) => <div key={row.label} data-better={row.win === i ? "1" : undefined}><dt>{row.label}</dt><dd>{row.text[i]}{row.win === i && <span className="cl-cmp-mark" title="The stronger of the two"> ▲</span>}</dd></div>)}</dl>
                      </details>
                    ))}
                  </section>
                ))}
              </div>
              <p className="ap-fine mt-2">The marked value is the stronger of the two. Neither is a score: they are plain counts from your CRM. Rows with no data are left out.</p>
            </div>
          );
        }}
      </Load>
    </div>
  );
}

const csvCell = (v: string | number) => { const s = String(v).replace(/^([=+\-@\t\r])/, "'$1"); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const forClient = (x: Cl3Receipt) => [`${x.name}, week of ${x.weekStart}:`, ...(x.enough ? x.lines : ["Not enough activity this week to report on."])].join("\n");

export function Reports({ filters, onChanged }: Shared & { onChanged: () => void }) {
  const l = useList({ industry: filters.industry });
  const [weeks] = useState(() => { const d = Date.now(), mon = Math.floor(d / 86_400_000) * 86_400_000 - ((new Date(d).getUTCDay() + 6) % 7) * 86_400_000; return [1, 2, 3, 4].map((k) => new Date(mon - k * 7 * 86_400_000).toISOString().slice(0, 10)); });
  const [week, setWeek] = useState(""), [done, setDone] = useState(""), [open, setOpen] = useState<{ id: string; name: string } | null>(null), [pg, setPg] = useState(0);
  const r = useCl<Cl3ReceiptList>("receipt", { q: l.dq, industry: filters.industry, week: week || undefined });
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPg(0); }, [l.dq, week, filters.industry]);
  const copy = (x: Cl3Receipt) => { try { void navigator.clipboard.writeText(forClient(x)); setDone(x.locationId); setTimeout(() => setDone(""), 1500); } catch { setDone(""); } };
  const csv = (rows: Cl3Receipt[]) => {
    const head = ["Client", "Week starting", "Came in", "Answered", "Still waiting", "Booked", "Showed", "No-shows", "Appointments with no outcome", "Deals won", "Money won"];
    const body = rows.map((x) => [x.name, x.weekStart, x.cameIn, x.answered, x.stillWaiting, x.booked, x.showed, x.noshow, x.unmarked, x.won, Math.round(x.wonValue)].map(csvCell).join(","));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([[head.map(csvCell).join(","), ...body].join("\n")], { type: "text/csv" })); a.download = `weekly-client-report-${rows[0]?.weekStart ?? "week"}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <div data-testid="cl-reports">
      <Find q={l.q} setQ={l.setQ}>
        <select className="ap-field" aria-label="Week" value={week} onChange={(e) => setWeek(e.target.value)}><option value="">Last full week</option>{weeks.map((w) => <option key={w} value={w}>Week of {w}</option>)}</select>
      </Find>
      <Load r={r} empty={(d) => d.rows.length === 0}>
        {(d) => {
          const pages = Math.max(1, Math.ceil(d.rows.length / 20)), p = Math.min(pg, pages - 1), rows = d.rows.slice(p * 20, p * 20 + 20);
          return (
            <>
              <div className="ap-head print:hidden"><span className="ap-fine">Week of {d.weekStart}. A plain proof for each client: what came in, what was answered, what was booked and won.</span>
                <button type="button" className="s6-btn" onClick={() => csv(d.rows)}>Download CSV</button><button type="button" className="s6-btn" onClick={() => window.print()}>Print</button></div>
              <div className="ap-scroll"><table className="ap-t"><thead><tr><th>Client</th><th data-num>Came in</th><th data-num>Answered</th><th data-num>Still waiting</th><th data-num>Booked</th><th data-num>Showed</th><th data-num>Won</th><th className="print:hidden" /></tr></thead>
                <tbody>{rows.map((x) => (
                  <tr key={x.locationId} style={{ cursor: "default" }}><td><span className="ap-name">{x.name}</span></td>
                    {x.enough ? <><td data-num>{x.cameIn}</td><td data-num>{x.answered}</td><td data-num>{x.stillWaiting}</td><td data-num>{x.booked}</td><td data-num>{x.showed}</td><td data-num>{money(x.wonValue)}</td></> : <td colSpan={6} className="ap-fine">{NOT_ENOUGH} this week</td>}
                    <td className="print:hidden"><button type="button" className="ap-link" onClick={() => copy(x)}>{done === x.locationId ? "Copied" : "Copy for client"}</button>{" "}<button type="button" className="ap-link" onClick={() => setOpen({ id: x.locationId, name: x.name })}>Settings</button></td></tr>
                ))}</tbody></table></div>
              <Pager page={p} pages={pages} total={d.rows.length} set={setPg} />
              {d.rows[0]?.historyStarts && <p className="ap-fine">Our own record starts {d.rows[0].historyStarts}; earlier weeks may be incomplete.</p>}
            </>
          );
        }}
      </Load>
      {open && <AccountSettings key={open.id} id={open.id} name={open.name} onClose={() => setOpen(null)} onChanged={onChanged} />}
    </div>
  );
}

export function People({ filters }: Shared) {
  const l = useList(filters);
  const r = useCl<Cl3People>("people", l.params);
  return (
    <div data-testid="cl-people">
      <Find q={l.q} setQ={l.setQ} />
      <Load r={r} empty={(p) => p.rows.length === 0}>
        {(p) => (
          <>
            <p className="ap-fine mb-2">{p.idleCount > 0 ? `${p.idleCount} ${p.idleCount === 1 ? "person has" : "people have"} gone quiet (no messages sent for 7 days) and ${p.idleCount === 1 ? "is" : "are"} listed first.` : "Nobody has gone quiet."}{p.accountsWithoutStaff > 0 ? ` ${p.accountsWithoutStaff} client ${p.accountsWithoutStaff === 1 ? "account has" : "accounts have"} no team members we can see.` : ""}</p>
            <div className="ap-scroll"><table className="ap-t"><thead><tr><th>Person</th><th>Account</th><th data-num>Messages sent</th><th data-num>Leads touched</th><th>Last active</th></tr></thead>
              <tbody>{p.rows.map((x) => <tr key={`${x.locationId}:${x.userId}`} style={{ cursor: "default" }}><td><span className="ap-name">{x.name}</span><RoleChip userId={x.userId} locationId={x.locationId} /></td><td>{x.accountName}</td><td data-num>{x.messagesSent}</td><td data-num>{x.leadsTouched}</td><td>{x.idle ? <span className="ap-chip" data-tone="amber">Gone quiet</span> : ago(x.lastActiveAt)}</td></tr>)}</tbody></table></div>
            <Pager page={p.page} pages={p.pages} total={p.total} set={l.setPage} />
          </>
        )}
      </Load>
    </div>
  );
}

const scopeText = (s: "ok" | "needs_permission" | "unknown") => (s === "ok" ? "Allowed" : s === "needs_permission" ? RECONNECT : "Not checked yet");
const SUB_OK = /^(active|trialing|trial|paid)$/i;

export function Setup({ filters, billingOn }: Shared & { billingOn: boolean }) {
  const l = useList(filters);
  const r = useCl<Cl3SetupList>("setup", l.params);
  return (
    <div data-testid="cl-setup">
      <Find q={l.q} setQ={l.setQ} />
      <Load r={r} empty={(p) => p.rows.length === 0}>
        {(p) => (
          <>
            <p className="ap-fine mb-2">{p.needAction > 0 ? `${p.needAction} client ${p.needAction === 1 ? "account needs" : "accounts need"} a look, listed first.` : "Every client account is connected and up to date."}</p>
            <div className="ap-scroll"><table className="ap-t"><thead><tr><th>Account</th><th>Connection</th><th>Data last updated</th><th>Calendar</th><th>Team list</th><th>Channels seen</th></tr></thead>
              <tbody>{p.rows.map((x) => (
                <tr key={x.locationId} style={{ cursor: "default" }} data-tone={x.needsHelp.length ? "amber" : undefined}><td><span className="ap-name">{x.name}</span></td>
                  <td>{!x.connected ? "Not connected" : x.message ?? "Connected"}</td><td>{ago(x.lastSyncAt)}{x.syncOld ? " (out of date)" : ""}</td>
                  <td>{scopeText(x.scopes.calendar)}</td><td>{scopeText(x.scopes.users)}{x.usersState === "ok" ? ` (${x.users})` : ""}</td><td>{x.channelsSeen.length ? x.channelsSeen.join(", ") : "None seen in 30 days"}</td></tr>
              ))}</tbody></table></div>
            <Pager page={p.page} pages={p.pages} total={p.total} set={l.setPage} />
          </>
        )}
      </Load>
      {billingOn && <Plans filters={filters} />}
    </div>
  );
}

/** The plan and subscription status the platform reports per account. Failed payments, the next payment date and the apps installed are not in the platform's API, so they say so. */
function Plans({ filters }: Shared) {
  const l = useList(filters);
  const r = useCl<Cl3BillingList>("billing", l.params);
  return (
    <section className="cl-drill" data-testid="cl-billing" aria-label="Plan and subscription">
      <h3 className="mb-1 text-base font-semibold">Plan and subscription</h3>
      <p className="ap-fine mb-2">Plan is the plan your platform bills this client account on. Failed payments, the next payment date and installed apps: {NOT_FROM_PLATFORM}.</p>
      <Load r={r} empty={(b) => b.rows.length === 0}>
        {(b) => (
          <>
            {(b.needPermission > 0 || b.notActive > 0) && <p className="ap-fine mb-2">{b.notActive > 0 ? `${b.notActive} not active. ` : ""}{b.needPermission > 0 ? `${b.needPermission} need permission: reconnect.` : ""}</p>}
            <div className="ap-scroll"><table className="ap-t"><thead><tr><th>Account</th><th>Plan</th><th>Subscription</th><th>Failed payments, next payment, apps</th></tr></thead>
              <tbody>{b.rows.map((x: Cl3Billing) => (
                <tr key={x.locationId} style={{ cursor: "default" }} data-tone={x.subscriptionStatus && !SUB_OK.test(x.subscriptionStatus) ? "amber" : undefined}><td><span className="ap-name">{x.name}</span></td>
                  <td>{x.state === "ok" ? x.plan ?? "Plan name not given" : x.state === "no_plan" ? <span title="This account is not on a plan from you, or plan billing is switched off for it.">Not on a plan</span> : x.message ?? "Not checked yet"}</td><td>{x.subscriptionStatus ? x.subscriptionStatus.replace(/_/g, " ") : x.state === "ok" ? "Not given" : ""}</td><td className="ap-fine">{NOT_FROM_PLATFORM}</td></tr>
              ))}</tbody></table></div>
            <Pager page={b.page} pages={b.pages} total={b.total} set={l.setPage} />
            {b.rows[0]?.fetchedAt && <p className="ap-fine">Last read {day(b.rows[0].fetchedAt)}.</p>}
          </>
        )}
      </Load>
    </section>
  );
}
