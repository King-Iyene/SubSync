"use client";

import { useEffect, useRef, useState } from "react";
import { FEEDBACK_MAX, SEVERITIES, SEVERITY_LABEL, type Severity } from "@/lib/feedback";
import { lastErrorId, REPORT_EVENT } from "./ds/error-memory";
import { useApiClient } from "./session";
import { Btn, inputClass } from "./ui";

// "Give feedback" and "Report a problem" at the bottom of every page (N87). Two quiet text buttons; each opens a small form in place. What is typed is stored and
// never sent anywhere from here (the alert to King is a dry-run line written by the server). A problem report carries the error ID the screen showed.
type Mode = null | "feedback" | "problem";

export function FeedbackBox({ page }: { page: string }) {
  const api = useApiClient();
  const [mode, setMode] = useState<Mode>(null);
  const [text, setText] = useState("");
  const [severity, setSeverity] = useState<Severity>("idea");
  const [errorId, setErrorId] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ reference: string; kind: "feedback" | "problem" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLElement>(null);

  useEffect(() => {
    const open = (e: Event) => {
      const id = (e as CustomEvent<{ errorId?: string | null }>).detail?.errorId ?? lastErrorId() ?? "";
      setMode("problem"); setErrorId(id); setDone(null); setError(null);
      box.current?.scrollIntoView({ block: "center" });
    };
    window.addEventListener(REPORT_EVENT, open);
    return () => window.removeEventListener(REPORT_EVENT, open);
  }, []);

  const start = (m: Exclude<Mode, null>) => { setMode(m); setDone(null); setError(null); if (m === "problem") setErrorId(lastErrorId() ?? ""); };
  const close = () => { setMode(null); setText(""); setError(null); };

  const send = async () => {
    if (!mode) return;
    setBusy(true); setError(null);
    try {
      const res = await api.post<{ reference: string }>(mode === "feedback" ? "feedback" : "problem", mode === "feedback" ? { message: text, page, severity } : { message: text, page, errorId: errorId.trim() || undefined });
      setDone({ reference: res.reference, kind: mode });
      setMode(null); setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <footer ref={box} className="mt-12 border-t pt-4 text-sm print:hidden" data-testid="feedback-box" aria-label="Feedback">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-muted-foreground">
        <span>Something missing, or something wrong?</span>
        <button type="button" className="min-h-9 underline underline-offset-4 hover:text-foreground" aria-expanded={mode === "feedback"} onClick={() => (mode === "feedback" ? close() : start("feedback"))}>Give feedback</button>
        <button type="button" className="min-h-9 underline underline-offset-4 hover:text-foreground" aria-expanded={mode === "problem"} onClick={() => (mode === "problem" ? close() : start("problem"))}>Report a problem</button>
      </div>
      {done && (
        <p className="mt-3 border-l-2 border-primary py-1 pl-3" role="status" data-testid="feedback-done">
          Thank you. {done.kind === "feedback" ? "We read every note." : "We will look into it."} Your reference is <strong className="font-mono">{done.reference}</strong>.
        </p>
      )}
      {mode && (
        <form className="mt-3 max-w-xl space-y-3" onSubmit={(e) => { e.preventDefault(); void send(); }} onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
          <div>
            <label htmlFor="fb-text" className="mb-1 block font-medium">{mode === "feedback" ? "What should we add, change or fix?" : "What went wrong?"}</label>
            <textarea id="fb-text" rows={4} maxLength={FEEDBACK_MAX} required className={inputClass} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={mode === "feedback" ? "For example: I would like to see this by team member." : "For example: the list never loaded after I pressed Try again."} />
            <p className="mt-1 text-xs text-muted-foreground">You are on the {page} page. Please do not paste passwords or customers&apos; private details.</p>
          </div>
          {mode === "feedback" ? (
            <div>
              <label htmlFor="fb-sev" className="mb-1 block font-medium">How much does it matter?</label>
              <select id="fb-sev" className={`${inputClass} max-w-xs`} value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label htmlFor="fb-err" className="mb-1 block font-medium">Error ID (filled in if a screen showed one)</label>
              <input id="fb-err" className={`${inputClass} max-w-xs font-mono`} value={errorId} onChange={(e) => setErrorId(e.target.value)} placeholder="E-4F2A9C" maxLength={24} />
            </div>
          )}
          {error && <p className="border-l-2 border-destructive py-1 pl-3" role="alert">{error}</p>}
          <div className="flex gap-2">
            <Btn type="submit" variant="primary" disabled={busy || text.trim().length === 0}>{busy ? "Sending..." : mode === "feedback" ? "Send feedback" : "Send report"}</Btn>
            <Btn type="button" variant="ghost" onClick={close}>Cancel</Btn>
          </div>
        </form>
      )}
    </footer>
  );
}
