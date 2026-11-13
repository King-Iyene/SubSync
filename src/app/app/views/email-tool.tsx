"use client";

import { useState } from "react";
import { recordResults, type EmailFacts } from "@/lib/connections/tools-status";
import { InlineAlert } from "../ds";
import { useApiClient } from "../session";
import { Badge, Btn, inputClass, timeAgo } from "../ui";

export type EmailCheck = { status: "ok" | "warning" | "critical" | "error"; checkedAt: string; domain: string | null; findings: Array<{ severity: "critical" | "warning" | "info" | "good"; area: string; message: string; fix?: string }> };
export type EmailData = { address: string | null; hasAddress: boolean; canManage: boolean; sendingLive: boolean; mailReady: boolean; check: EmailCheck | null };
type Sent = { text: string; dryRun: boolean; preview: { to: string; subject: string; body: string } | null };

export const emailFactsOf = (e: EmailData, check: EmailCheck | null): EmailFacts => ({ address: e.address ?? (e.hasAddress ? "your saved address" : null), check: check ? { status: check.status, checkedAt: check.checkedAt } : null, sendingLive: e.sendingLive });

/** The Email row's controls: save the address, check its public records (SPF, DKIM, DMARC) right here, and send a test (a dry run while sending is switched off). */
export function EmailTool({ email, check, onCheck, reload }: { email: EmailData; check: EmailCheck | null; onCheck: (c: EmailCheck) => void; reload: () => Promise<void> }) {
  const api = useApiClient();
  const [value, setValue] = useState(email.address ?? "");
  const [busy, setBusy] = useState<"save" | "verify" | "test" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);

  if (!email.canManage) return <p className="text-xs text-muted-foreground">Ask your administrator to change the address.</p>;
  const changed = value.trim() !== (email.address ?? "");
  const run = async (what: "save" | "verify" | "test") => {
    setBusy(what); setMsg(null); setSent(null);
    try {
      if (what === "save") {
        await api.put("settings", { digestEmail: value.trim() === "" ? null : value.trim() });
        await reload();
        setMsg({ ok: true, text: value.trim() === "" ? "Address removed." : "Saved. Press Check records to test it." });
      } else if (what === "verify") {
        const r = await api.post<{ check: EmailCheck }>("st/email-verify");
        onCheck(r.check);
      } else {
        const r = await api.post<{ ok: boolean } & Sent>("st/email-test");
        setSent(r);
      }
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(null); }
  };

  const rows = check ? recordResults(check.findings) : [];
  return (
    <div className="space-y-3" data-testid="email-tool">
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (changed) void run("save"); }}>
        <label className="min-w-0 grow text-sm sm:max-w-sm">Address for alerts and summaries
          <input className={`${inputClass} mt-1`} type="email" autoComplete="email" value={value} onChange={(e) => setValue(e.target.value)} placeholder="you@yourcompany.com" data-testid="email-address" />
        </label>
        <Btn type="submit" variant="primary" disabled={!changed || busy !== null}>{busy === "save" ? "Saving..." : "Save address"}</Btn>
      </form>
      <div className="flex flex-wrap gap-2">
        <Btn disabled={!email.hasAddress || changed || busy !== null} onClick={() => void run("verify")} testId="email-verify">{busy === "verify" ? "Checking..." : check ? "Check again" : "Check records"}</Btn>
        <Btn disabled={!email.hasAddress || changed || busy !== null} onClick={() => void run("test")} testId="email-test">{busy === "test" ? "Preparing..." : "Send me a test"}</Btn>
      </div>
      <p className="text-sm"><a className="font-medium underline underline-offset-4 max-sm:inline-block max-sm:py-3" href="#email">Open email sender health for every client</a></p>
      {msg && <InlineAlert tone={msg.ok ? "success" : "danger"}>{msg.text}</InlineAlert>}
      {check && (
        <div className="rounded-lg border p-3" data-testid="email-records">
          <p className="text-xs text-muted-foreground">Public records of {check.domain ?? "your domain"}, checked {timeAgo(check.checkedAt)}. No sign-in needed.</p>
          <ul className="mt-2 space-y-2 text-sm">
            {rows.map((r) => <li key={r.area} className="flex flex-wrap items-start gap-2"><Badge tone={r.tone}>{r.label}</Badge><span className="min-w-0 flex-1">{r.text}</span></li>)}
          </ul>
        </div>
      )}
      {sent && (
        <div className="rounded-lg border p-3 text-sm" role="status" data-testid="email-sent" data-dry-run={sent.dryRun ? "yes" : "no"}>
          <p className="font-medium">{sent.text}</p>
          {sent.preview && <p className="mt-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">{sent.preview.subject}</span><br />{sent.preview.body}</p>}
        </div>
      )}
    </div>
  );
}
