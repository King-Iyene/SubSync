"use client";

import { useState } from "react";
import { useApiClient, useData } from "../session";
import type { DomainCheck } from "../types";
import { Badge, Btn, Card, Empty, ErrorBox, inputClass, Loading, PageHeader, severityTone, timeAgo } from "../ui";

type Data = { checks: DomainCheck[]; unchecked: Array<{ domain: string; locationId: string; locationName: string | null }> };

const statusLabel = { ok: "Passing", warning: "Needs attention", critical: "Broken", error: "Could not check" } as const;
const statusTone = { ok: "good", warning: "warn", critical: "bad", error: "neutral" } as const;

export function EmailHealthView() {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<Data>("email");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const run = async (domains: string[], locationId?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await api.post("email/check", { domains, locationId });
      setDomain("");
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Email health"
        subtitle="Checks each client's sending domain for SPF, DKIM and DMARC, the records Gmail and Yahoo now require. Broken records mean client emails land in spam or get rejected."
        actions={data.unchecked.length > 0 ? <Btn disabled={busy} onClick={() => run(data.unchecked.map((u) => u.domain))}>Check all {data.unchecked.length} new domains</Btn> : undefined}
      />
      <form className="mb-4 flex max-w-xl gap-2" onSubmit={(e) => { e.preventDefault(); void run(domain.split(/[\s,]+/).filter(Boolean)); }}>
        <input className={inputClass} placeholder="Check a domain, for example clientsite.com" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Domain to check" />
        <Btn type="submit" variant="primary" disabled={busy || !domain.trim()}>{busy ? "Checking..." : "Check"}</Btn>
      </form>
      {msg && <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm" role="alert">{msg}</p>}

      {data.checks.length === 0 && data.unchecked.length === 0 ? (
        <Empty title="No domains yet" body="Enter a client's domain above. Domains from each account's profile appear here automatically after the first sync." />
      ) : (
        <div className="space-y-3">
          {data.checks.map((c) => {
            const expanded = open === c.domain;
            return (
              <Card key={c.domain}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{c.domain}</p>
                    <p className="text-xs text-muted-foreground">{c.locationName ?? "Not linked to an account"} · checked {timeAgo(c.checkedAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={statusTone[c.status]}>{statusLabel[c.status]}</Badge>
                    <Btn variant="ghost" disabled={busy} onClick={() => run([c.domain], c.locationId ?? undefined)}>Re-check</Btn>
                    <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : c.domain)} className="rounded-lg border px-3 py-1 text-sm hover:bg-muted">{expanded ? "Hide" : "Details"}</button>
                  </div>
                </div>
                {expanded && c.report && (
                  <ul className="mt-4 space-y-3 border-t pt-4">
                    {c.report.findings.map((f, i) => (
                      <li key={i} className="flex items-start gap-3 text-sm">
                        <Badge tone={severityTone(f.severity)}>{f.area.toUpperCase()}</Badge>
                        <div><p>{f.message}</p>{f.fix && <p className="mt-0.5 text-xs text-muted-foreground">Fix: {f.fix}</p>}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
          {data.unchecked.length > 0 && (
            <Card title="Found on account profiles, not checked yet">
              <ul className="divide-y">
                {data.unchecked.map((u) => (
                  <li key={u.domain} className="flex items-center justify-between py-2 text-sm first:pt-0 last:pb-0">
                    <span>{u.domain} <span className="text-muted-foreground">· {u.locationName ?? "Unnamed account"}</span></span>
                    <Btn disabled={busy} onClick={() => run([u.domain], u.locationId)}>Check</Btn>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">DKIM is detected on common selectors only. If your sending service uses a custom selector it shows as &quot;not found&quot; even when it is set up, so confirm in the service itself.</p>
    </div>
  );
}
