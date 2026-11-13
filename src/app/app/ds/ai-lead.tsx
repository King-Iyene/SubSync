"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { useApiClient, useData } from "../session";

// The lead AI jobs in the screens people work in (docs/AI_AGENTS_PLAN.md). Everything here is a SUGGESTION: nothing is sent to a lead and nothing is written to the CRM. Each entry point is shown
// only when its own flag is on; the buttons work only when the account has connected its own AI and switched the job on in Settings, AI, and say plainly what is missing when not.

export type AiLeadStatus = { flags: Record<string, boolean>; ready: Record<string, boolean>; why: Record<string, string>; killed: boolean };
export type Sent = { fields: string[]; includesNames: boolean; text: string } | null;

/** Which lead AI jobs are on, and usable, for this account (or for one lead's account). A failed read means "off": the buttons are simply not shown. */
export function useAiLead(locationId?: string): AiLeadStatus | null {
  const q = useData<AiLeadStatus>(`ai/lead/status${locationId ? `?locationId=${encodeURIComponent(locationId)}` : ""}`);
  return q.data ?? null;
}

const WHY: Record<string, string> = {
  no_connection: "Connect your AI account in Settings, AI to use this.", job_off: "Switch this job on in Settings, AI.", paused: "AI is paused in Settings, AI.", needs_attention: "Your AI key needs attention. Replace it in Settings, AI.",
};
export const whyNot = (st: AiLeadStatus | null, job: string) => WHY[st?.why?.[job] ?? ""] ?? "Ask an administrator to connect AI in Settings, AI.";

/** "What was sent to your AI": the exact fields and text, shown after every run. */
export function SentBox({ sent, testId }: { sent: Sent; testId?: string }) {
  if (!sent) return null;
  return (
    <details className="mt-2 text-xs" data-testid={testId ?? "ai-sent"}>
      <summary className="cursor-pointer text-muted-foreground">What was sent to your AI</summary>
      <p className="mt-1 text-muted-foreground">Fields: {sent.fields.join("; ")}. Names and message text included: {sent.includesNames ? "yes (you allowed it in Settings, AI)" : "no"}.</p>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2">{sent.text}</pre>
    </details>
  );
}

type SummaryAnswer = { ok: true; json: { who: string; happened: string; next: string } | null; cached: boolean; sent: Sent } | { ok: false; error: string; sent: Sent };

/** On a lead's side panel: one short summary of who they are, what happened and what to do next. */
export function LeadAiSummary({ locationId, contactId, dnd }: { locationId: string; contactId: string; dnd: boolean }) {
  const api = useApiClient();
  const st = useAiLead(locationId);
  const [busy, setBusy] = useState(false);
  const [ans, setAns] = useState<SummaryAnswer | null>(null);
  if (!st?.flags.lead_summary || dnd) return null;
  const ready = st.ready.lead_summary === true;
  const run = async () => {
    setBusy(true);
    try { setAns(await api.post<SummaryAnswer>("ai/lead/summary", { locationId, contactId })); } catch { setAns({ ok: false, error: "The AI summary did not work. Nothing was changed. Try again in a moment.", sent: null }); }
    setBusy(false);
  };
  return (
    <section className="mt-4 rounded-lg border bg-card p-3" aria-label="AI summary" data-testid="ai-lead-summary">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void run()} disabled={busy || !ready} title={ready ? undefined : whyNot(st, "lead_summary")} data-testid="ai-summarise"
          className="ds-press inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border bg-card px-3 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"><Sparkles aria-hidden className="size-4" />{busy ? "Reading this lead..." : "Summarise and suggest next step"}</button>
        {!ready && <span className="text-xs text-muted-foreground" data-testid="ai-summary-why">{whyNot(st, "lead_summary")}</span>}
      </div>
      {ans && ans.ok && ans.json && (
        <div className="mt-3 space-y-1.5 text-sm" data-testid="ai-summary-answer">
          <p><b>Who:</b> {ans.json.who}</p><p><b>What happened:</b> {ans.json.happened}</p><p><b>Next step:</b> {ans.json.next}</p>
          <p className="text-xs text-muted-foreground">AI suggestion. Nothing was sent to this person and nothing was changed in your CRM.{ans.cached ? " Shown from the last time you asked for the same facts." : ""}</p>
        </div>
      )}
      {ans && !ans.ok && <p className="mt-2 text-sm text-destructive" role="alert" data-testid="ai-summary-error">{ans.error}</p>}
      {ans && <SentBox sent={ans.sent} />}
    </section>
  );
}

type DraftAnswer = { ok: true; text: string; sent: Sent } | { ok: false; error: string; sent: Sent };

/** In the message box: asks for a draft and puts it in the box for the person to read and edit. Never sends. */
export function AiDraftButton({ locationId, contactId, channel, hasText, onDraft }: { locationId: string; contactId: string; channel: "SMS" | "Email" | "WhatsApp"; hasText: boolean; onDraft: (text: string) => void }) {
  const api = useApiClient();
  const st = useAiLead(locationId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent>(null);
  if (!st?.flags.reply_draft) return null;
  const ready = st.ready.reply_draft === true;
  const run = async () => {
    if (hasText && !window.confirm("Replace what you have typed with an AI draft?")) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<DraftAnswer>("ai/lead/draft", { locationId, contactId, channel: channel === "Email" ? "Email" : "SMS" });
      setSent(r.sent);
      if (r.ok) onDraft(r.text.trim()); else setErr(r.error);
    } catch { setErr("The AI draft did not work. Nothing was changed. Try again in a moment."); }
    setBusy(false);
  };
  return (
    <span className="inline-flex flex-col" data-testid="ai-draft">
      <button type="button" onClick={() => void run()} disabled={busy || !ready} title={ready ? "Write a first draft you can edit. Nothing is sent." : whyNot(st, "reply_draft")} data-testid="ai-draft-btn"
        className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-[15px] font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"><Sparkles aria-hidden className="size-4" />{busy ? "Drafting..." : "Draft with AI"}</button>
      {err && <span className="mt-1 text-xs text-destructive" role="alert" data-testid="ai-draft-error">{err}</span>}
      {sent && !err && <SentBox sent={sent} testId="ai-draft-sent" />}
    </span>
  );
}
