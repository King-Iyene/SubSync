"use client";

import { useState } from "react";
import { HowTo, InlineAlert, Section } from "../ds";
import { useApiClient, useData } from "../session";
import { Badge, Btn, Empty, ErrorBox, ExtLink, fmtInt, inputClass, Loading, timeAgo } from "../ui";

// Clean-up, Duplicates tab (stage C2). Three steps per pair: pick the contact to keep, check the differences, merge in your CRM.
// SubSync never merges or deletes. It records what you decided and checks again later.

type PersonUi = {
  contactId: string; name: string; email: string | null; phone: string | null; tags: string[]; createdAt: string | null; lastActivityAt: string | null; source: string | null;
  openDeals: number; wonDeals: number; upcomingAppointments: number; hasConversation: boolean; dnd: boolean; url: string;
};
type Guard = { level: "ok" | "warn" | "block"; blocks: string[]; warnings: string[] };
type Pair = {
  score: number; reasons: string[]; keepId: string; keepReason: string; a: PersonUi; b: PersonUi; guards: Record<string, Guard>;
  differences: Array<{ field: string; values: [string | null, string | null]; differs: boolean }>;
};
type Group = {
  key: string; locationId: string; locationName: string | null; confidence: number; kind: "exact" | "format" | "name" | "shared";
  label: { title: string; line: string; tone: "good" | "warn" | "neutral"; showPercent: boolean }; reasons: string[]; total: number; contactIds: string[];
  guard: Guard; pairs: Pair[]; review: { decision: string; keepContactId: string | null; decidedAt: string | null } | null; recheck: boolean;
};
type Data = {
  summary: { exact: number; format: number; name: number; shared: number; contacts: number; reviewed: number; accounts: Array<{ locationId: string; name: string | null; groups: number; contacts: number; allowDuplicates: boolean | null }> };
  truncated: boolean; canReview: boolean; total: number; groups: Group[];
  source: { total: number; line: string; days: Array<{ day: string; count: number; share: number; looksLikeImport: boolean }>; sources: Array<{ source: string; count: number }> };
};
type Preview = { dryRun: true; count: number; contacts: number };

const PAGE = 10;

export function DuplicatesView() {
  const api = useApiClient();
  const [kind, setKind] = useState<"" | "likely" | "shared">("");
  const [account, setAccount] = useState("");
  const [showReviewed, setShowReviewed] = useState(false);
  const qs = [kind && `kind=${kind}`, account && `account=${encodeURIComponent(account)}`, showReviewed && "reviewed=1"].filter(Boolean).join("&");
  const { data, error, loading, reload } = useData<Data>(`duplicates${qs ? `?${qs}` : ""}`);
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirm, setConfirm] = useState("");

  if (loading && !data) return <Loading label="Checking contacts for duplicates..." />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const s = data.summary;
  const likely = s.exact + s.format + s.name;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: done });
      setPreview(null);
      setConfirm("");
      await reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const decide = (g: Group, decision: "not_duplicate" | "merged_in_platform", keepId: string | null, text: string) =>
    run(() => api.post("duplicates/review", { locationId: g.locationId, contactIds: g.contactIds, decision, keepContactId: keepId }), text);
  const bulkBody = (dryRun: boolean) => ({ decision: "not_duplicate", kind: "shared", minConfidence: 0, maxConfidence: 100, dryRun, ...(dryRun ? {} : { confirm: Number(confirm) }) });
  const visible = data.groups.slice(0, shown);

  return (
    <div>
      {msg && <p className={`mb-4 rounded-lg border px-3 py-2 text-sm ${msg.ok ? "bg-muted/40" : "border-red-300 bg-red-50 text-red-800"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}

      <Section title={`${fmtInt(likely)} group${likely === 1 ? "" : "s"} that may be the same person`} hint={s.shared > 0 ? `${fmtInt(s.shared)} more share a phone or email but look like different people.` : undefined}
        action={<Btn onClick={() => api.download("export/duplicates", "subsync-duplicates.csv")}>Export list</Btn>}>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">Show</span>
            <select className={inputClass} value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setShown(PAGE); setOpen(null); }}>
              <option value="">Everything</option>
              <option value="likely">Likely the same person</option>
              <option value="shared">Probably different people</option>
            </select>
          </label>
          {s.accounts.length > 1 && (
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">Client account</span>
              <select className={inputClass} value={account} onChange={(e) => { setAccount(e.target.value); setShown(PAGE); setOpen(null); }}>
                <option value="">All accounts</option>
                {s.accounts.filter((a) => a.groups > 0).map((a) => <option key={a.locationId} value={a.locationId}>{a.name ?? "Unnamed account"}</option>)}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
            <input type="checkbox" className="size-4" checked={showReviewed} onChange={(e) => setShowReviewed(e.target.checked)} /> Show groups I already checked
          </label>
        </div>
        <HowTo id="c2-dupes" title="How merging works">
          <p>1. Pick the contact to keep. 2. Check what is different. 3. Merge in your CRM.</p>
          <p>SubSync does not change your contacts. It tells you what it found and remembers what you decided.</p>
        </HowTo>
      </Section>

      {data.source.total > 0 && (
        <Section title="Where they came from" hint={data.source.line}>
          <ul className="space-y-1 text-sm">
            {data.source.days.slice(0, 3).map((d) => <li key={d.day}>{d.day}: {fmtInt(d.count)} records{d.looksLikeImport ? " (looks like an import)" : ""}</li>)}
            {data.source.sources.slice(0, 2).map((x) => <li key={x.source} className="text-muted-foreground">Source &quot;{x.source}&quot;: {fmtInt(x.count)} records</li>)}
          </ul>
        </Section>
      )}

      <Section title="Groups to check" hint={data.truncated ? "This account is large. The biggest groups come first." : undefined}>
        {visible.length === 0 ? (
          <Empty title="Nothing to check" body="No two contacts look like the same person, or you have checked them all." />
        ) : (
          <ul className="divide-y rounded-xl border bg-card" data-testid="dupe-groups">
            {visible.map((g) => (
              <GroupRow key={g.locationId + g.key} g={g} isOpen={open === g.locationId + g.key} onToggle={() => setOpen(open === g.locationId + g.key ? null : g.locationId + g.key)}
                canReview={data.canReview} busy={busy} onDecide={decide}
                onUndo={() => run(() => api.post("duplicates/undo", { locationId: g.locationId, key: g.key }), "Done. The group is back in the list.")} />
            ))}
          </ul>
        )}
        {data.groups.length > shown && (
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-xs text-muted-foreground">Showing {shown} of {fmtInt(data.total)}</span>
            <Btn variant="secondary" onClick={() => setShown(shown + PAGE)}>Show more</Btn>
          </div>
        )}
      </Section>

      {data.canReview && s.shared > 0 && (
        <Section title="Clear the lists of different people" hint="This only changes SubSync's own notes. Your contacts stay as they are. At most 50 groups at a time.">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Btn disabled={busy} onClick={async () => { setBusy(true); try { setPreview(await api.post<Preview>("duplicates/bulk", bulkBody(true))); setMsg(null); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); } }}>Count them</Btn>
            {preview && (preview.count === 0 ? <span>Nothing to clear.</span> : (
              <>
                <span>{fmtInt(preview.count)} group{preview.count === 1 ? "" : "s"} ({fmtInt(preview.contacts)} contacts).</span>
                <label className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Type {preview.count} to confirm</span><input className={`${inputClass} w-24`} inputMode="numeric" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
                <Btn variant="primary" disabled={busy || Number(confirm) !== preview.count} onClick={() => run(() => api.post("duplicates/bulk", bulkBody(false)), `Done. ${preview.count} group${preview.count === 1 ? "" : "s"} marked as different people.`)}>Mark as different people</Btn>
              </>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function GroupRow({ g, isOpen, onToggle, canReview, busy, onDecide, onUndo }: {
  g: Group; isOpen: boolean; onToggle: () => void; canReview: boolean; busy: boolean;
  onDecide: (g: Group, d: "not_duplicate" | "merged_in_platform", keep: string | null, text: string) => void; onUndo: () => void;
}) {
  const done = g.review && !g.recheck;
  return (
    <li>
      <button type="button" aria-expanded={isOpen} onClick={onToggle} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40">
        <span className="min-w-0">
          <span className="font-medium">{g.label.title}</span>
          <span className="block text-xs text-muted-foreground">{g.locationName ?? "Unnamed account"} · {fmtInt(g.total)} records{g.label.showPercent ? ` · ${g.confidence}% sure` : ""}</span>
        </span>
        <span className="flex items-center gap-2">
          {g.guard.level === "block" && g.kind !== "shared" && <Badge tone="warn">Leave for now</Badge>}
          {g.recheck && <Badge tone="warn">Still here</Badge>}
          {done && <Badge tone="good">{g.review!.decision === "not_duplicate" ? "Different people" : "Merged in your CRM"}{g.review!.decidedAt ? ` ${timeAgo(g.review!.decidedAt)}` : ""}</Badge>}
          <span aria-hidden className="text-muted-foreground">{isOpen ? "Hide" : "Open"}</span>
        </span>
      </button>
      {isOpen && <GroupDetail g={g} done={!!done} canReview={canReview} busy={busy} onDecide={onDecide} onUndo={onUndo} />}
    </li>
  );
}

function GroupDetail({ g, done, canReview, busy, onDecide, onUndo }: {
  g: Group; done: boolean; canReview: boolean; busy: boolean;
  onDecide: (g: Group, d: "not_duplicate" | "merged_in_platform", keep: string | null, text: string) => void; onUndo: () => void;
}) {
  const api = useApiClient();
  const [all, setAll] = useState<PersonUi[] | null>(null);
  const [allErr, setAllErr] = useState<string | null>(null);
  const [keepBy, setKeepBy] = useState<Record<number, string>>({});
  const shared = g.kind === "shared";
  const seeAll = async () => {
    try {
      setAll((await api.get<{ people: PersonUi[] }>(`duplicates/group?locationId=${encodeURIComponent(g.locationId)}&key=${encodeURIComponent(g.key)}`)).people);
    } catch (e) {
      setAllErr((e as Error).message);
    }
  };
  return (
    <div className="space-y-4 border-t bg-muted/20 p-4">
      <p className="text-sm">{g.label.line}</p>
      {g.recheck && <InlineAlert tone="warning" title="You said you merged these">They are still listed. Check your CRM, or tell us they are different people.</InlineAlert>}
      {g.guard.level === "block" && g.guard.blocks.map((b) => <InlineAlert key={b} tone="warning">{b}</InlineAlert>)}
      {g.pairs.map((p, i) => {
        const keepId = keepBy[i] ?? p.keepId;
        const guard = p.guards[keepId] ?? { level: "ok", blocks: [], warnings: [] };
        const other = keepId === p.a.contactId ? p.b : p.a;
        const kept = keepId === p.a.contactId ? p.a : p.b;
        return (
          <div key={p.a.contactId + p.b.contactId} className="rounded-xl border bg-card p-4" data-testid="dupe-pair">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Pair {i + 1} of {g.pairs.length}{!shared ? ` · ${p.score}% sure` : ""}</p>
            {!shared && (
              <>
                <h3 className="mb-2 text-sm font-semibold">1. Pick the contact to keep</h3>
                <div className="mb-4 grid gap-2 md:grid-cols-2">
                  {[p.a, p.b].map((x) => (
                    <label key={x.contactId} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${keepId === x.contactId ? "border-primary bg-primary/5" : ""}`}>
                      <input type="radio" className="mt-0.5 size-4" name={`keep-${g.key}-${i}`} checked={keepId === x.contactId} disabled={!canReview || done} onChange={() => setKeepBy({ ...keepBy, [i]: x.contactId })} />
                      <span className="min-w-0">
                        <span className="block font-medium">Keep {x.name}</span>
                        {x.contactId === p.keepId && <span className="block text-xs text-muted-foreground">Suggested. {p.keepReason}.</span>}
                      </span>
                    </label>
                  ))}
                </div>
                <h3 className="mb-2 text-sm font-semibold">2. Check the differences</h3>
              </>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              {[p.a, p.b].map((x) => <RecordCard key={x.contactId} x={x} />)}
            </div>
            {!shared && (
              <p className="mt-2 text-xs text-muted-foreground">
                {p.differences.filter((d) => d.differs).length === 0 ? "Name, email and phone match." : `Different: ${p.differences.filter((d) => d.differs).map((d) => d.field.toLowerCase()).join(", ")}.`}
              </p>
            )}
            {!shared && guard.blocks.map((b) => <p key={b} className="mt-2 text-sm font-medium text-red-700" role="alert">{b}</p>)}
            {!shared && guard.warnings.length > 0 && guard.level === "warn" && <p className="mt-2 text-sm text-amber-800">{guard.warnings.join(" ")} Check before you merge.</p>}
            {!shared && guard.level !== "block" && (
              <>
                <h3 className="mb-2 mt-4 text-sm font-semibold">3. Merge in your CRM</h3>
                <p className="mb-2 text-xs text-muted-foreground">Open both. In your CRM, tick both people in Contacts and choose Merge. Keep {kept.name}. Check payments there first, SubSync cannot see them.</p>
                <div className="flex flex-wrap items-center gap-3">
                  <Btn variant="primary" onClick={() => { window.open(kept.url, "_blank", "noopener,noreferrer"); window.open(other.url, "_blank", "noopener,noreferrer"); }}>Open both in your CRM</Btn>
                  <ExtLink href={kept.url}>{kept.name}</ExtLink>
                  <ExtLink href={other.url}>{other.name}</ExtLink>
                </div>
              </>
            )}
          </div>
        );
      })}
      {g.total > 3 ? (
        <div>
          {all === null ? <Btn variant="secondary" onClick={seeAll}>See all {fmtInt(g.total)}</Btn> : (
            <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border bg-card text-sm">
              {all.map((x) => <li key={x.contactId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"><span className="min-w-0 truncate">{x.name}<span className="text-xs text-muted-foreground"> {x.email ?? ""} {x.phone ?? ""}</span></span><ExtLink href={x.url}>Open</ExtLink></li>)}
            </ul>
          )}
          {allErr && <p className="mt-1 text-xs text-red-700">{allErr}</p>}
        </div>
      ) : null}
      {canReview && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          {!done ? (
            <>
              {!shared && g.guard.level !== "block" && <Btn disabled={busy} onClick={() => onDecide(g, "merged_in_platform", keepBy[0] ?? g.pairs[0]?.keepId ?? null, "Saved. We will check again tomorrow that it went through.")}>I merged them in my CRM</Btn>}
              <Btn variant={shared ? "primary" : "ghost"} disabled={busy} onClick={() => onDecide(g, "not_duplicate", null, "Saved. These will not be flagged again.")}>These are different people</Btn>
            </>
          ) : <Btn variant="ghost" disabled={busy} onClick={onUndo}>Undo my answer</Btn>}
        </div>
      )}
    </div>
  );
}

function RecordCard({ x }: { x: PersonUi }) {
  return (
    <div className="min-w-0 rounded-lg border p-3 text-sm">
      <p className="truncate font-medium">{x.name}</p>
      {x.dnd && <p className="text-xs font-semibold text-amber-800">Do not disturb</p>}
      <dl className="mt-1 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">Email</dt><dd className="truncate">{x.email ?? "none"}</dd>
        <dt className="text-muted-foreground">Phone</dt><dd className="truncate">{x.phone ?? "none"}</dd>
        <dt className="text-muted-foreground">Added</dt><dd>{x.createdAt ? timeAgo(x.createdAt) : "unknown"}{x.source ? `, ${x.source}` : ""}</dd>
        <dt className="text-muted-foreground">Last activity</dt><dd>{x.lastActivityAt ? timeAgo(x.lastActivityAt) : "none"}</dd>
        <dt className="text-muted-foreground">Deals</dt><dd>{x.openDeals} open, {x.wonDeals} won</dd>
        {x.upcomingAppointments > 0 && <><dt className="text-muted-foreground">Appointments</dt><dd>{x.upcomingAppointments} coming up</dd></>}
        {x.tags.length > 0 && <><dt className="text-muted-foreground">Tags</dt><dd className="truncate">{x.tags.join(", ")}</dd></>}
      </dl>
    </div>
  );
}
