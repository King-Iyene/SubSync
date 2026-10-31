"use client";

import { useEffect, useState } from "react";
import { useApiClient, useData } from "../session";
import { Badge, Btn, Card, Empty, ErrorBox, ExtLink, fmtMoney, inputClass, Loading, PageHeader, Stat } from "../ui";

type Preset = { id: string; label: string; help: string };
type Row = {
  contactId: string; locationId: string; locationName: string | null; name: string; phone: string | null; email: string | null;
  priority: number; reasons: string[]; idleDays: number | null; openValue: number; lastOutcome: string | null; followUpAt: string | null; url: string;
};
type Stats = { calls: number; reached: number; booked: number; reachRate: number | null };
type Queue = {
  presets: Preset[]; filters: Record<string, unknown>; outcomes: Record<string, string>; total: number;
  speedToLead: { last15: number; last60: number }; summary: { today: Stats; week: Stats; session: Stats | null }; rows: Row[];
};
type Lists = { lists: Array<{ id: string; name: string; filters: Record<string, string | number>; createdAt: string | null }>; max: number };

const OUTCOME_ORDER = ["answered", "voicemail", "no_answer", "wrong_number", "booked", "not_interested", "follow_up"] as const;
const tone = (s: number) => (s >= 70 ? "good" : s >= 40 ? "warn" : "neutral");

function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function CallsView() {
  const api = useApiClient();
  const [preset, setPreset] = useState("hot_uncontacted");
  const [tag, setTag] = useState("");
  const [idleDays, setIdleDays] = useState("");
  const [deal, setDeal] = useState("");
  const [location, setLocation] = useState("");
  const [powerStart, setPowerStart] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState("");

  const params = new URLSearchParams({ preset });
  if (preset === "custom") {
    if (tag) params.set("tag", tag);
    if (idleDays) params.set("idleDays", idleDays);
    if (deal) params.set("deal", deal);
  }
  if (location) params.set("location", location);
  const queue = useData<Queue>(`call-queue?${params.toString()}`);
  const lists = useData<Lists>("call-lists");
  const accounts = useData<{ accounts: Array<{ locationId: string; name: string | null }> }>("health");
  const session = useData<{ session: Stats | null }>(powerStart ? `call-outcomes?since=${encodeURIComponent(new Date(powerStart).toISOString())}` : null);

  useEffect(() => {
    if (!powerStart) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [powerStart]);

  const data = queue.data;
  const left = powerStart ? powerStart + 3_600_000 - now : null;
  const current = data?.rows[0];

  const log = async (row: Row, outcome: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await api.post("call-outcomes", { locationId: row.locationId, contactId: row.contactId, outcome, note: note || undefined });
      setNote("");
      await queue.reload();
      if (powerStart) await session.reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setMsg(null);
    try {
      await api.post("call-lists", { name, filters: { preset, tag, idleDays, deal, location } });
      setName("");
      await lists.reload();
      setMsg("List saved.");
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const load = (f: Record<string, string | number>) => {
    setPreset(String(f.preset ?? "hot_uncontacted"));
    setTag(String(f.tag ?? ""));
    setIdleDays(f.idleDays === undefined ? "" : String(f.idleDays));
    setDeal(String(f.deal ?? ""));
    setLocation(String(f.location ?? ""));
  };

  if (queue.loading && !data) return <Loading />;
  if (queue.error) return <ErrorBox error={queue.error} onRetry={queue.reload} />;
  if (!data) return null;
  const help = data.presets.find((p) => p.id === preset)?.help;

  return (
    <div className="space-y-6">
      <PageHeader title="Call lists" subtitle="Who to call next, most important first. Log each call and SubSync keeps the list moving." actions={
        powerStart ? <Btn onClick={() => setPowerStart(null)}>End power hour</Btn> : <Btn variant="primary" onClick={() => { setNow(Date.now()); setPowerStart(Date.now()); }}>Start power hour</Btn>
      } />

      {data.speedToLead.last15 > 0 && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm" role="alert">
          {data.speedToLead.last15} new lead{data.speedToLead.last15 === 1 ? "" : "s"} in the last 15 minutes with no reply. Call now: the first to respond usually wins.
        </p>
      )}

      {powerStart && left !== null && (
        <Card title={left > 0 ? `Power hour: ${mmss(left)} left` : "Power hour finished"}>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-muted-foreground">Calls</dt><dd className="text-lg font-semibold tabular-nums">{session.data?.session?.calls ?? 0}</dd></div>
            <div><dt className="text-muted-foreground">Reached</dt><dd className="text-lg font-semibold tabular-nums">{session.data?.session?.reached ?? 0}</dd></div>
            <div><dt className="text-muted-foreground">Booked</dt><dd className="text-lg font-semibold tabular-nums">{session.data?.session?.booked ?? 0}</dd></div>
          </dl>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="In this list" value={data.total} />
        <Stat label="Calls, last 24 hours" value={data.summary.today.calls} sub={`${data.summary.today.booked} booked`} />
        <Stat label="Reached, last 24 hours" value={data.summary.today.reached} sub={data.summary.today.reachRate === null ? undefined : `${data.summary.today.reachRate}% of calls`} />
        <Stat label="Calls, last 7 days" value={data.summary.week.calls} sub={`${data.summary.week.booked} booked`} />
      </div>

      <Card title="Choose a list">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="preset" className="mb-1 block text-sm font-medium">List</label>
            <select id="preset" className={inputClass} value={preset} onChange={(e) => setPreset(e.target.value)}>
              {data.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            {help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
          </div>
          <div>
            <label htmlFor="acct" className="mb-1 block text-sm font-medium">Client account</label>
            <select id="acct" className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="">All accounts</option>
              {accounts.data?.accounts.map((a) => <option key={a.locationId} value={a.locationId}>{a.name ?? "Unnamed account"}</option>)}
            </select>
          </div>
          {preset === "custom" && (
            <>
              <div><label htmlFor="tag" className="mb-1 block text-sm font-medium">Has tag</label><input id="tag" className={inputClass} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. vip" maxLength={60} /></div>
              <div><label htmlFor="idle" className="mb-1 block text-sm font-medium">No activity for (days)</label><input id="idle" className={inputClass} inputMode="numeric" value={idleDays} onChange={(e) => setIdleDays(e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 14" /></div>
              <div><label htmlFor="deal" className="mb-1 block text-sm font-medium">Deal</label>
                <select id="deal" className={inputClass} value={deal} onChange={(e) => setDeal(e.target.value)}><option value="">Any</option><option value="open">Has an open deal</option><option value="none">No deal</option></select></div>
            </>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input className={`${inputClass} max-w-xs`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this list to save it" maxLength={60} aria-label="List name" />
          <Btn onClick={save} disabled={!name.trim()}>Save list</Btn>
          {lists.data?.lists.map((l) => (
            <span key={l.id} className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm">
              <button type="button" onClick={() => load(l.filters)} className="hover:underline">{l.name}</button>
              <button type="button" aria-label={`Delete ${l.name}`} className="text-muted-foreground hover:text-foreground" onClick={async () => { await api.del(`call-lists/${l.id}`); await lists.reload(); }}>x</button>
            </span>
          ))}
        </div>
        {msg && <p className="mt-2 text-sm text-muted-foreground" role="status">{msg}</p>}
      </Card>

      {data.rows.length === 0 ? <Empty title="Nobody on this list right now" body="Try another list, or sync again. People you just called are hidden for 12 hours." /> : (
        <>
          {current && (
            <Card title="Call this person now">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{current.name} <Badge tone={tone(current.priority)}>{current.priority}</Badge></p>
                  <p className="text-sm text-muted-foreground">{current.locationName}{current.openValue > 0 ? `, deal worth ${fmtMoney(current.openValue)}` : ""}</p>
                  <p className="mt-1 text-sm">
                    {current.phone ? <a className="font-medium underline" href={`tel:${current.phone}`}>{current.phone}</a> : "No phone number"}
                    {current.email ? <span className="text-muted-foreground">, {current.email}</span> : null}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{current.reasons.join(", ")}</p>
                </div>
                <ExtLink href={current.url}>Open in platform</ExtLink>
              </div>
              <input className={`${inputClass} mt-3`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" maxLength={500} aria-label="Call note" />
              <div className="mt-3 flex flex-wrap gap-2">
                {OUTCOME_ORDER.map((o) => <Btn key={o} disabled={busy} variant={o === "booked" ? "primary" : "secondary"} onClick={() => log(current, o)}>{o === "follow_up" ? "Follow up in 3 days" : data.outcomes[o]}</Btn>)}
              </div>
            </Card>
          )}
          <Card title={`Up next (${data.total})`}>
            <ul className="divide-y text-sm">
              {data.rows.slice(1, 25).map((r) => (
                <li key={`${r.locationId}-${r.contactId}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="font-medium">{r.name} <Badge tone={tone(r.priority)}>{r.priority}</Badge></p>
                    <p className="text-xs text-muted-foreground">{r.locationName}{r.idleDays !== null ? `, quiet ${r.idleDays}d` : ""}{r.reasons.length ? `, ${r.reasons.slice(0, 2).join(", ")}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs">{r.phone && <a className="underline" href={`tel:${r.phone}`}>{r.phone}</a>}<ExtLink href={r.url}>Open</ExtLink></div>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
