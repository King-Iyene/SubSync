"use client";

import { useState } from "react";
import { INSTANT_LABEL, INSTANT_LEVELS, TRIAGE_STATUSES, type InstantLevel, type TriageStatus } from "@/lib/feedback-alert";
import { useApiClient, useData } from "../session";
import { Badge, Btn, Card, ErrorBox, inputClass, Loading, PageHeader } from "../ui";

type Item = { itemKind: "feedback" | "suggestion"; id: string; ref: string; kind: string; severity: string; company: string; companyName: string | null; page: string | null; status: TriageStatus; message: string; errorId: string | null; at: string };
type Data = {
  items: Item[]; total: number; newCount: number; hasMore: boolean;
  settings: { digestOn: boolean | null; instantLevel: InstantLevel };
  votes: Array<{ itemKey: string; votes: number; companies: number }>;
  records: Array<{ key: string; at: string | null; held: number; detail: unknown }>;
  delivery: { emailSet: boolean; slackSet: boolean; emailLive: boolean; slackLive: boolean; includeText: boolean; digestEnv: boolean };
};

const STATUS_LABEL: Record<TriageStatus, string> = { new: "New", seen: "Seen", planned: "Planned", done: "Done", wontfix: "Won't fix" };
const SEV_TONE: Record<string, "bad" | "warn" | "neutral"> = { blocking: "bad", annoying: "warn", idea: "neutral" };

// The platform owner's Feedback inbox. Only the owner ever reaches this (the server answers 404 to anyone else). Everything people typed is shown as plain text.
// Replying to a sender is not built yet (follow-up): the inbox is read, filter and mark.
export function OwnerFeedbackView() {
  const api = useApiClient();
  const [kind, setKind] = useState(""); const [severity, setSeverity] = useState(""); const [status, setStatus] = useState(""); const [q, setQ] = useState(""); const [page, setPage] = useState(0);
  const query = new URLSearchParams({ ...(kind ? { kind } : {}), ...(severity ? { severity } : {}), ...(status ? { status } : {}), ...(q.trim() ? { q: q.trim() } : {}), page: String(page) }).toString();
  const { data, error, loading, reload } = useData<Data>(`owner/feedback?${query}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key); setProblem(null);
    try { await work(); await reload(); window.dispatchEvent(new Event("subsync-owner-feedback")); } catch (e) { setProblem((e as Error).message); } finally { setBusy(null); }
  };
  const mark = (it: Item, to: TriageStatus) => run(`${it.id}`, () => api.post("owner/feedback/status", { itemKind: it.itemKind, id: it.id, status: to }));
  const digestOn = data.settings.digestOn ?? data.delivery.digestEnv;
  const d = data.delivery;

  return (
    <div className="max-w-5xl" data-testid="owner-feedback">
      <PageHeader title="Feedback (owner)" subtitle={`${data.newCount} new. Visible only to you. Nothing here is shown to customers.`} />
      {problem && <p className="mb-3 border-l-2 border-destructive py-1 pl-3 text-sm" role="alert">{problem}</p>}

      <Card title="Alerts to you">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="of-level" className="mb-1 block text-sm font-medium">Instant alerts for</label>
            <select id="of-level" className={inputClass} value={data.settings.instantLevel} disabled={busy === "settings"} onChange={(e) => void run("settings", () => api.post("owner/feedback/settings", { instantLevel: e.target.value }))}>
              {INSTANT_LEVELS.map((l) => <option key={l} value={l}>{INSTANT_LABEL[l]}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={digestOn} disabled={busy === "settings"} onChange={(e) => void run("settings", () => api.post("owner/feedback/settings", { digestOn: e.target.checked }))} />
              Send me a daily summary
            </label>
            <p className="text-xs text-muted-foreground">One message a day with counts and the newest five. {digestOn ? "On." : "Off."}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground" data-testid="delivery-status">
          Email {d.emailSet ? (d.emailLive ? "is live" : "is set, but the send switch is off (a rehearsal only)") : "is not set up"}. Slack {d.slackSet ? (d.slackLive ? "is live" : "is set, but the send switch is off (a rehearsal only)") : "is not set up"}. Message text in alerts: {d.includeText ? "on" : "off (ids only)"}.
        </p>
        {data.records.length > 0 && (
          <ul className="mt-2 text-xs text-muted-foreground">
            {data.records.map((r) => <li key={r.key}>{r.key}: {r.at ? new Date(r.at).toLocaleString() : "never"}{r.held > 0 ? `, ${r.held} held back` : ""}</li>)}
          </ul>
        )}
      </Card>

      <form className="my-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setPage(0); }}>
        <div><label htmlFor="of-q" className="mb-1 block text-xs">Search</label><input id="of-q" className={`${inputClass} w-56`} value={q} maxLength={80} onChange={(e) => { setQ(e.target.value); setPage(0); }} /></div>
        <div><label htmlFor="of-kind" className="mb-1 block text-xs">Kind</label>
          <select id="of-kind" className={inputClass} value={kind} onChange={(e) => { setKind(e.target.value); setPage(0); }}><option value="">All</option><option value="feedback">Feedback</option><option value="problem">Problem</option><option value="suggestion">Suggestion</option></select></div>
        <div><label htmlFor="of-sev" className="mb-1 block text-xs">Severity</label>
          <select id="of-sev" className={inputClass} value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(0); }}><option value="">All</option><option value="blocking">Stuck</option><option value="annoying">Annoying</option><option value="idea">Idea</option></select></div>
        <div><label htmlFor="of-status" className="mb-1 block text-xs">Status</label>
          <select id="of-status" className={inputClass} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}><option value="">All</option>{TRIAGE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></div>
      </form>

      <p className="mb-2 text-sm text-muted-foreground">{data.total} item{data.total === 1 ? "" : "s"}, newest first.</p>
      {data.items.length === 0 ? <p className="border-y py-6 text-sm text-muted-foreground">Nothing here yet.</p> : (
        <ul className="divide-y border-y" data-testid="owner-feedback-list">
          {data.items.map((it) => (
            <li key={`${it.itemKind}:${it.id}`} className="py-3" data-ref={it.ref}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="font-mono">{it.ref}</span>
                <Badge tone={SEV_TONE[it.severity] ?? "neutral"}>{it.kind}, {it.severity === "blocking" ? "stuck" : it.severity}</Badge>
                <span>account {it.company}{it.companyName ? ` (${it.companyName})` : ""}</span>
                <span>page {it.page ?? "unknown"}</span>
                {it.errorId && <span className="font-mono">{it.errorId}</span>}
                <time dateTime={it.at}>{new Date(it.at).toLocaleString()}</time>
                <Badge tone={it.status === "new" ? "info" : "neutral"}>{STATUS_LABEL[it.status]}</Badge>
              </div>
              {/* What the person typed: rendered as text by React, never as markup. */}
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{it.message}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {TRIAGE_STATUSES.filter((s) => s !== it.status).map((s) => <Btn key={s} variant="ghost" disabled={busy === it.id} onClick={() => void mark(it, s)}>Mark {STATUS_LABEL[s].toLowerCase()}</Btn>)}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        <Btn variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Newer</Btn>
        <Btn variant="secondary" disabled={!data.hasMore} onClick={() => setPage(page + 1)}>Older</Btn>
      </div>

      {data.votes.length > 0 && (
        <Card title="Votes on the roadmap" className="mt-6">
          <ul className="text-sm">{data.votes.map((v) => <li key={v.itemKey}>{v.itemKey}: {v.votes} vote{v.votes === 1 ? "" : "s"} from {v.companies} compan{v.companies === 1 ? "y" : "ies"}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}
