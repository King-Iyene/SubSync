"use client";

import { useEffect, useState } from "react";
import { previewChange, QUEUES, type QueueKey } from "@/lib/call-queue-tags/tags";
import type { CheckResult } from "@/lib/call-queue-tags/check";
import { remember } from "../ds/remember";
import { useApiClient, useData } from "../session";
import { Badge, Btn, Card, inputClass } from "../ui";
import { GUIDE_REQUEST_KEY } from "./st-state";
import { CreateTagButton, CrmSetupCard } from "./safe-writes-ui";

// Settings, Call queues. The tag names that start each call queue in one account, a check that the CRM is set up, and (agency only, when switched on) the optional one-click setup.
// The workflows only give your own team a call task. Everything that changes is previewed first; reset is a change too.
type Row = { key: QueueKey; label: string; what: string; defaultTag: string; workflow: string | null; tag: string };
type Tags = { canEdit: boolean; kind: string; tags: Record<QueueKey, string>; queues: Row[]; snapshot: { show: boolean; steps?: string[] } };
const tone = (s: string) => (s === "found" || s === "ok" ? "good" : s === "needs_permission" ? "warn" : "neutral") as "good" | "warn" | "neutral";

export function CallQueueTagsCard() {
  const api = useApiClient();
  const accts = useData<{ accounts: { id: string; name: string }[] }>("cqt/accounts");
  const [loc, setLoc] = useState("");
  useEffect(() => { if (!loc && accts.data?.accounts[0]) setLoc(accts.data.accounts[0].id); }, [accts.data, loc]);
  const cur = useData<Tags>(loc ? `cqt/tags?locationId=${encodeURIComponent(loc)}` : null);
  const [draft, setDraft] = useState<Partial<Record<QueueKey, string>>>({});
  const [review, setReview] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  useEffect(() => { setDraft({}); setReview(false); setMsg(null); setResult(null); }, [loc]);

  const d = cur.data;
  const wanted = Object.fromEntries(Object.entries(draft).filter(([k, v]) => v !== undefined && d && v !== d.tags[k as QueueKey]));
  const pv = d ? previewChange(d.tags, wanted) : null;
  const canEdit = d?.canEdit === true;

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await api.put("cqt/tags", { locationId: loc, tags: wanted });
      setMsg({ ok: true, text: "Saved. SubSync will look for these tags from now on." });
      setDraft({}); setReview(false); setResult(null); await cur.reload();
    } catch (e) { setMsg({ ok: false, text: e instanceof Error && e.message ? e.message : "Could not save just now. Try again." }); }
    setBusy(false);
  };
  const check = async () => {
    setBusy(true); setMsg(null);
    try { setResult(await api.post<CheckResult>("cqt/check", { locationId: loc })); }
    catch { setMsg({ ok: false, text: "Could not check just now. Try again in a minute." }); }
    setBusy(false);
  };
  const openSetup = async () => {
    try { const r = await api.get<{ url: string }>("cqt/snapshot", { fresh: true }); window.open(r.url, "_blank", "noopener,noreferrer"); }
    catch { setMsg({ ok: false, text: "The setup link is not available right now." }); }
  };

  return (
    <div className="space-y-4" data-testid="cq-tags">
      <Card title="Call queue tags">
        <p className="text-sm text-muted-foreground">Each call queue starts when a contact gets its tag in your CRM. Use the default names, or type the names your account already uses. SubSync looks for these names when it builds your call lists.</p>
        <p className="mt-1 text-sm"><a href="#help" className="font-medium underline underline-offset-4" data-testid="cq-guide-link" onClick={() => remember(GUIDE_REQUEST_KEY, "set-up-call-queues")}>Read the guide: Set up your call queues</a></p>
        {(accts.data?.accounts.length ?? 0) > 1 && (
          <label className="mt-3 flex flex-wrap items-center gap-2 text-sm"><span>Account</span>
            <select aria-label="Account" className={`${inputClass} !w-auto max-w-full`} value={loc} onChange={(e) => setLoc(e.target.value)}>{accts.data!.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </label>
        )}
        {!d ? <p className="mt-3 text-sm text-muted-foreground">{cur.error ? "Could not load the tags." : "Loading..."}</p> : (
          <div className="mt-3 space-y-3">
            {d.queues.map((q) => {
              const val = draft[q.key] ?? q.tag;
              const err = pv?.errors[q.key];
              return (
                <div key={q.key} className="grid gap-1 border-t pt-3 first:border-t-0 first:pt-0 sm:grid-cols-[14rem_1fr]" data-testid={`cq-row-${q.key}`}>
                  <div><p className="text-sm font-medium">{q.label}</p><p className="text-xs text-muted-foreground">{q.what}</p></div>
                  <div>
                    <p className="text-xs text-muted-foreground">Now: <strong className="font-medium">{q.tag}</strong>{q.tag === q.defaultTag ? " (default)" : ` (default: ${q.defaultTag})`}</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <input aria-label={`${q.label} tag`} className={`${inputClass} !w-auto min-w-0 flex-1`} maxLength={80} disabled={!canEdit || busy} value={val} onChange={(e) => { setDraft({ ...draft, [q.key]: e.target.value }); setReview(false); }} />
                      {canEdit && q.tag !== q.defaultTag && <Btn disabled={busy} onClick={() => { setDraft({ ...draft, [q.key]: q.defaultTag }); setReview(true); }}>Reset to default</Btn>}
                    </div>
                    {err && <p className="mt-1 text-xs text-destructive" role="alert">{err}</p>}
                  </div>
                </div>
              );
            })}
            {!canEdit && <p className="text-xs text-muted-foreground">Ask an administrator to change these names.</p>}
            {canEdit && (
              <div className="space-y-2">
                {!review && <Btn variant="primary" disabled={busy || !pv || !pv.ok || pv.rows.length === 0} onClick={() => setReview(true)} testId="cq-review">Review change</Btn>}
                {review && pv && pv.ok && pv.rows.length > 0 && (
                  <div className="rounded-lg border p-3" data-testid="cq-preview">
                    <p className="text-sm font-medium">This is what will change</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">{pv.rows.map((r) => <li key={r.key}>{r.line}</li>)}</ul>
                    <p className="mt-1 text-xs text-muted-foreground">Your CRM is not changed. Workflows you already built keep listening for their old tag until you edit them.</p>
                    <div className="mt-2 flex flex-wrap gap-2"><Btn variant="primary" disabled={busy} onClick={() => void save()} testId="cq-save">{busy ? "Saving..." : "Save"}</Btn><Btn disabled={busy} onClick={() => setReview(false)}>Keep editing</Btn></div>
                  </div>
                )}
              </div>
            )}
            {msg && <p className={`border-l-2 py-1 pl-3 text-sm ${msg.ok ? "border-success" : "border-destructive"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
          </div>
        )}
      </Card>

      <Card title="Check that it worked">
        <p className="text-sm text-muted-foreground">SubSync looks in your CRM for these tags and the three call workflows: {QUEUES.filter((q) => q.workflow).map((q) => q.workflow).join(", ")}. Imported or hand-built workflows arrive switched on.</p>
        <div className="mt-2"><Btn disabled={busy || !loc} onClick={() => void check()} testId="cq-check">Check that it worked</Btn></div>
        {result && (
          <div className="mt-3" data-testid="cq-result">
            <p className="text-sm font-medium">{result.summary}</p>
            <ul className="mt-1 space-y-1 text-sm">{result.lines.map((l) => <li key={l.id} className="flex flex-wrap items-center gap-2"><Badge tone={tone(l.state)}>{l.state === "found" ? "Found" : l.state === "missing" ? "Not yet" : "Reconnect"}</Badge><span>{l.text}</span>{l.state === "missing" && l.id.startsWith("tag:") && canEdit && d && <CreateTagButton locationId={loc} name={d.tags[l.id.slice(4) as QueueKey] ?? ""} onDone={() => void check()} />}</li>)}</ul>
          </div>
        )}
      </Card>

      {loc && canEdit && <CrmSetupCard locationId={loc} />}

      {d?.snapshot.show && (
        <Card title="One-click setup (optional)">
          <p className="text-sm text-muted-foreground">Import the ready-made workflows into a client account instead of building them by hand.</p>
          <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm" data-testid="cq-snapshot-steps">{(d.snapshot.steps ?? []).map((s) => <li key={s}>{s}</li>)}</ol>
          <div className="mt-2"><Btn onClick={() => void openSetup()} testId="cq-snapshot-open">Open the setup link</Btn></div>
        </Card>
      )}
    </div>
  );
}
