"use client";

import { useState } from "react";
import { useApiClient } from "../session";
import { RowsDrawer, useAidStatus } from "./ask-data";

// Clean-up: the AI data jobs. Data review (a plain-English audit with numbers that open their rows), Cleaning proposals (a reviewable batch that is only ever applied in Fix data, with its own
// preview, typed confirmation and undo), Setup check (what is not set up in a client account) and, on each Likely or Possible duplicate group, an AI opinion that never merges anything.
// Every card draws nothing unless its flag is on, and says why when the account has not connected its AI or switched the job on.

const BTN = "ds-press inline-flex min-h-10 items-center justify-center rounded-lg border bg-card px-3 text-sm font-medium hover:border-primary/40 hover:bg-accent/50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const PRIMARY = "ds-press inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const SEV = { high: "border-red-400/50 bg-red-500/10", medium: "border-amber-400/50 bg-amber-500/10", low: "bg-muted/40" } as const;

type Finding = { id: string; severity: keyof typeof SEV; title: string; explanation: string; count: number; rowsHash: string };
type Proposal = { contactId: string; name: string; action: string; problem: string; before: string | null; after: string | null; protect: string | null; reason: string; confidence: "high" | "medium"; canApply: boolean };
type Merge = { key: string; badge: string; people: string[]; protectedCount: number };
type Issue = { id: string; title: string; why: string; fix: string; severity: keyof typeof SEV };
type Fail = { ok: false; error: string };
const ACTION_WORDS: Record<string, string> = { set_phone: "Write the phone number in one standard form", set_name: "Tidy the name", set_email: "Fix the email address", flag_test: "Looks like a test record: a person should look" };

function Off({ job, status }: { job: "data_review" | "data_clean" | "setup_audit"; status: ReturnType<typeof useAidStatus>["data"] }) {
  const j = status?.jobs[job];
  if (!j) return null;
  if (!j.connected) return <p className="text-sm text-muted-foreground" role="status">Connect your own AI account first (Settings, Integrations, AI).</p>;
  if (!j.on) return <p className="text-sm text-muted-foreground" role="status">This is off for the account. Switch it on in Settings, Integrations, AI.</p>;
  return null;
}

export function AiDataCards({ account, accounts, go }: { account: string | null; accounts: Array<{ id: string; name: string }>; go?: () => void }) {
  const st = useAidStatus(), api = useApiClient();
  const s = st.data;
  const [pick, setPick] = useState<string>(account ?? accounts[0]?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null), [err, setErr] = useState<string | null>(null);
  const [review, setReview] = useState<{ summary: string; findings: Finding[]; scope: string } | null>(null);
  const [clean, setClean] = useState<{ proposals: Proposal[]; merges: Merge[]; rules: string[] } | null>(null);
  const [setup, setSetup] = useState<{ issues: Issue[]; allFine: boolean; facts: Array<{ id: string; ok: boolean; text: string }> } | null>(null);
  const [rows, setRows] = useState<{ hash: string; label: string } | null>(null);
  const [made, setMade] = useState<{ runId: string; total: number } | null>(null);
  if (!s || !(s.jobs.data_review.flag || s.jobs.data_clean.flag || s.jobs.setup_audit.flag) || !s.canReview) return null;
  const acct = account ?? pick;
  const call = async <T,>(key: string, path: string, body: Record<string, unknown>, ok: (r: T) => void) => {
    setBusy(key); setErr(null);
    try { const r = await api.post<(T & { ok: true }) | Fail>(path, body); if (r.ok) ok(r as T); else setErr((r as Fail).error); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <section className="space-y-4 rounded-xl border bg-card p-4" aria-label="AI help with your data" data-testid="ai-data-cards">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h3 className="text-base font-semibold">AI help with your data</h3><p className="text-sm text-muted-foreground">It reads and suggests. Nothing is changed, sent, merged or deleted by the AI.</p></div>
        {!account && accounts.length > 1 && (
          <label className="text-sm">Client account <select value={pick} onChange={(e) => { setPick(e.target.value); setClean(null); setSetup(null); setMade(null); }} className="ml-1 min-h-10 rounded-lg border bg-background px-2">{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        )}
      </div>
      {err && <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert" data-testid="ai-data-error">{err}</p>}

      {s.jobs.data_review.flag && (
        <div className="space-y-2" data-testid="ai-review">
          <h4 className="font-medium">Data review</h4>
          <Off job="data_review" status={s} />
          {s.jobs.data_review.connected && s.jobs.data_review.on && <button type="button" className={PRIMARY} disabled={busy !== null} onClick={() => void call<{ summary: string; findings: Finding[]; scope: string }>("review", "aid/act/review", { account: account ?? "" }, (r) => setReview(r))}>{busy === "review" ? "Reviewing..." : "Review my data"}</button>}
          {review && (
            <div className="space-y-2">
              <p>{review.summary}</p>
              {review.findings.length === 0 && <p className="text-sm text-muted-foreground">No finding passed our checks. Open Fix data to see every problem.</p>}
              <ul className="space-y-2">{review.findings.map((f) => (
                <li key={f.id} className={`rounded-lg border p-3 ${SEV[f.severity]}`}>
                  <div className="flex items-start justify-between gap-3"><p className="font-medium">{f.title} <span className="text-xs font-normal text-muted-foreground">({f.severity})</span></p>
                    <button type="button" className={BTN} onClick={() => setRows({ hash: f.rowsHash, label: f.title })} data-testid="ai-review-rows">Rows ({f.count.toLocaleString("en-US")})</button></div>
                  <p className="text-sm">{f.explanation}</p>
                </li>))}</ul>
            </div>
          )}
        </div>
      )}

      {s.jobs.data_clean.flag && s.canClean && (
        <div className="space-y-2 border-t pt-3" data-testid="ai-clean">
          <h4 className="font-medium">Cleaning proposals</h4>
          <Off job="data_clean" status={s} />
          {!acct ? <p className="text-sm text-muted-foreground">Choose a client account.</p> : s.jobs.data_clean.connected && s.jobs.data_clean.on && (
            <>
              <p className="text-xs text-muted-foreground">Contact details are the data here, so this needs your account&apos;s &quot;allow names&quot; switch in Settings, AI.</p>
              <button type="button" className={PRIMARY} disabled={busy !== null} onClick={() => void call<{ proposals: Proposal[]; merges: Merge[]; rules: string[] }>("clean", "aid/act/clean", { account: acct }, (r) => { setClean(r); setMade(null); })}>{busy === "clean" ? "Checking fixes..." : "Suggest fixes"}</button>
            </>
          )}
          {clean && (
            <div className="space-y-2">
              <ul className="divide-y rounded-lg border" data-testid="ai-clean-list">{clean.proposals.map((p) => (
                <li key={p.contactId + p.action} className="space-y-0.5 px-3 py-2 text-sm">
                  <p className="font-medium">{p.name} <span className="text-xs font-normal text-muted-foreground">{ACTION_WORDS[p.action] ?? p.action} ({p.confidence} confidence)</span></p>
                  {p.after !== null && <p className="text-xs"><span className="text-muted-foreground">Now:</span> {p.before ?? "(empty)"} <span className="text-muted-foreground">Fix:</span> {p.after}</p>}
                  <p className="text-xs text-muted-foreground">{p.reason}{p.protect ? " Protected contact: a person decides." : ""}</p>
                </li>))}</ul>
              {clean.merges.length > 0 && <div><p className="text-sm font-medium">Merge candidates (from our matcher, not the AI)</p><ul className="text-sm text-muted-foreground">{clean.merges.map((m) => <li key={m.key}>{m.badge}: {m.people.join(", ")}{m.protectedCount ? " (someone here is protected)" : ""}</li>)}</ul><p className="text-xs text-muted-foreground">Merge them one at a time in the Duplicates list, where you preview, confirm and can undo.</p></div>}
              {clean.rules.length > 0 && !made && <div className="space-y-1">
                <button type="button" className={PRIMARY} disabled={busy !== null} onClick={() => void call<{ runId: string; total: number }>("preview", "aid/act/clean-preview", { account: acct, actions: clean.proposals.map((p) => p.action) }, (r) => setMade(r))}>Check these in Fix data</button>
                <p className="text-xs text-muted-foreground">This only makes a preview. Fix data shows every exact change for this kind of fix in the account (it may be more than the ones listed), asks you to type the number back, and can undo it.</p></div>}
              {made && <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm" role="status" data-testid="ai-clean-made">Preview ready: {made.total.toLocaleString("en-US")} changes are waiting for your review. Nothing has been changed. {go && <button type="button" className="underline" onClick={() => go()}>Open Fix data</button>}</p>}
            </div>
          )}
        </div>
      )}

      {s.jobs.setup_audit.flag && (
        <div className="space-y-2 border-t pt-3" data-testid="ai-setup">
          <h4 className="font-medium">Setup check</h4>
          <Off job="setup_audit" status={s} />
          {!acct ? <p className="text-sm text-muted-foreground">Choose a client account.</p> : s.jobs.setup_audit.connected && s.jobs.setup_audit.on && <button type="button" className={PRIMARY} disabled={busy !== null} onClick={() => void call<{ issues: Issue[]; allFine: boolean; facts: Array<{ id: string; ok: boolean; text: string }> }>("setup", "aid/act/setup-audit", { account: acct }, (r) => setSetup(r))}>{busy === "setup" ? "Checking..." : "Check this account's setup"}</button>}
          {setup && (setup.allFine ? <p className="text-sm">Everything we can check is set up.</p> : (
            <ul className="space-y-2">{setup.issues.map((i) => <li key={i.id} className={`rounded-lg border p-3 ${SEV[i.severity]}`}><p className="font-medium">{i.title}</p><p className="text-sm">{i.why}</p><p className="text-sm"><b>Fix:</b> {i.fix}</p></li>)}</ul>
          ))}
        </div>
      )}
      {rows && <RowsDrawer hash={rows.hash} account={account} label={rows.label} onClose={() => setRows(null)} />}
    </section>
  );
}

/** A small "AI opinion" on one Likely or Possible duplicate group. It never merges and never overrides the names rule. */
export function JudgeButton({ account, groupKey, tier }: { account: string; groupKey: string; tier: string }) {
  const st = useAidStatus(), api = useApiClient();
  const [busy, setBusy] = useState(false), [res, setRes] = useState<{ verdict: string; reasons: string[]; downgraded: boolean } | null>(null), [err, setErr] = useState<string | null>(null);
  const j = st.data?.jobs.dup_adjudicate;
  if (!j?.flag || !j.connected || !j.on || tier === "certain") return null;
  const run = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.post<{ ok: boolean; verdict: string; reasons: string[]; downgraded: boolean; error?: string }>("aid/act/dup-judge", { account, key: groupKey }); if (r.ok) setRes(r); else setErr(r.error ?? "No opinion."); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const word = res?.verdict === "same" ? "Looks like the same person" : res?.verdict === "different" ? "Looks like different people" : "Not sure";
  return (
    <span className="inline-flex flex-col gap-1" data-testid="dup-judge">
      <button type="button" className={BTN} disabled={busy} onClick={() => void run()} title="An AI opinion. It never merges anything; you still choose.">{busy ? "Thinking..." : "AI opinion"}</button>
      {err && <span className="text-xs text-destructive" role="alert">{err}</span>}
      {res && <span className="max-w-xs text-xs" role="status"><b>{word}.</b> {res.reasons.join(" ")} <span className="text-muted-foreground">You still choose.</span></span>}
    </span>
  );
}
