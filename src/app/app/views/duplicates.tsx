"use client";

import { useState } from "react";
import { useApiClient, useData } from "../session";
import { Badge, Btn, Card, Empty, ErrorBox, ExtLink, fmtInt, Loading, PageHeader, Stat, timeAgo } from "../ui";

type Person = {
  contactId: string; name: string; email: string | null; phone: string | null; tags: string[]; createdAt: string | null;
  lastActivityAt: string | null; source: string | null; openDeals: number; wonDeals: number; hasConversation: boolean; url: string;
};
type Choice = { field: string; keep: string; from: string; others: string[] };
type Group = {
  key: string; locationId: string; locationName: string | null; confidence: number; reasons: string[]; kind: "exact" | "format" | "name";
  survivorId: string; plan: Choice[]; people: Person[]; review: { decision: string; keepContactId: string | null; decidedAt: string | null } | null;
};
type Data = {
  summary: { exact: number; format: number; name: number; contacts: number; reviewed: number; crossAccount: number; accounts: Array<{ locationId: string; name: string | null; groups: number; contacts: number; allowDuplicates: boolean | null }> };
  truncated: boolean; canReview: boolean; groups: Group[];
};
type Preview = { dryRun: true; count: number; contacts: number; sample: Array<{ locationName: string | null; confidence: number; reasons: string[]; names: string[] }> };

const tone = (c: number) => (c >= 90 ? "bad" : c >= 75 ? "warn" : "neutral") as "bad" | "warn" | "neutral";
const KIND_LABEL = { exact: "Exact match", format: "Same, written differently", name: "Name only" } as const;

export function DuplicatesView() {
  const api = useApiClient();
  const [showReviewed, setShowReviewed] = useState(false);
  const { data, error, loading, reload } = useData<Data>(`duplicates${showReviewed ? "?reviewed=1" : ""}`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [range, setRange] = useState<"high" | "mid" | "low">("high");
  const [bulkAction, setBulkAction] = useState<"keep" | "not_duplicate">("keep");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");

  if (loading && !data) return <Loading label="Checking contacts for duplicates..." />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const s = data.summary;
  const bounds = { high: [90, 100], mid: [75, 89], low: [0, 74] }[range];

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: done });
      setPreview(null);
      await reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const decide = (g: Group, decision: "keep" | "not_duplicate" | "merged_in_platform", text: string) =>
    run(() => api.post("duplicates/review", { locationId: g.locationId, contactIds: g.people.map((p) => p.contactId), decision, keepContactId: decision === "not_duplicate" ? null : keep[g.key] ?? g.survivorId }), text);

  // One row per name in each account, with how many groups and records sit behind it. The detail only
  // appears when a row is opened, so a big account no longer prints thousands of cards.
  const nameOf = (g: Group) => (g.people.find((p) => p.contactId === g.survivorId) ?? g.people[0])?.name?.trim() || "No name";
  const byName = new Map<string, { key: string; name: string; locationName: string | null; groups: Group[]; records: number; top: number; reviewed: number }>();
  for (const g of data.groups) {
    const norm = nameOf(g).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const key = g.locationId + "|" + norm;
    const row = byName.get(key) ?? { key, name: nameOf(g), locationName: g.locationName, groups: [], records: 0, top: 0, reviewed: 0 };
    row.groups.push(g);
    row.records += g.people.length;
    row.top = Math.max(row.top, g.confidence);
    if (g.review) row.reviewed += 1;
    byName.set(key, row);
  }
  const needle = q.trim().toLowerCase();
  const rows = [...byName.values()]
    .filter((r) => !needle || r.name.toLowerCase().includes(needle) || (r.locationName ?? "").toLowerCase().includes(needle))
    .sort((a, b) => b.top - a.top || b.records - a.records || a.name.localeCompare(b.name));
  const PAGE = 20;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const at = Math.min(page, pages - 1);
  const pageRows = rows.slice(at * PAGE, at * PAGE + PAGE);

  const bulkBody = (dryRun: boolean) => ({ decision: bulkAction, minConfidence: bounds[0], maxConfidence: bounds[1], dryRun });

  return (
    <div>
      <PageHeader
        title="Duplicate contacts"
        subtitle="Likely duplicates inside each client account, scored by how sure we are, with a recommended record to keep. SubSync never changes your contacts: you merge in the platform, and we record what you decided."
        actions={<Btn onClick={() => api.download("export/duplicates", "subsync-duplicates.csv")}>Export CSV</Btn>}
      />
      {msg && <p className={`mb-4 rounded-lg border px-3 py-2 text-sm ${msg.ok ? "bg-muted/40" : "border-red-300 bg-red-50 text-red-800"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Exact matches" value={fmtInt(s.exact)} sub="same email or phone" tone={s.exact > 0 ? "bad" : undefined} />
        <Stat label="Written differently" value={fmtInt(s.format)} sub="phone format, email case" tone={s.format > 0 ? "warn" : undefined} />
        <Stat label="Contacts involved" value={fmtInt(s.contacts)} sub={`${s.reviewed} groups already reviewed`} />
        <Stat label="Same person, other clients" value={fmtInt(s.crossAccount)} sub="normal for an agency" />
      </div>

      <Card title="Is duplicate protection on?" className="mb-6">
        <p className="mb-3 text-sm text-muted-foreground">
          When a client account blocks duplicates, a new contact with an existing email or phone is merged into the old one instead of creating a second record. Old duplicates from before it was switched on, or from imports, stay until merged.
        </p>
        <ul className="divide-y text-sm">
          {s.accounts.map((a) => (
            <li key={a.locationId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="font-medium">{a.name ?? "Unnamed account"}</span>
              <span className="flex items-center gap-3">
                <span className="text-muted-foreground">{a.groups} group{a.groups === 1 ? "" : "s"} · {fmtInt(a.contacts)} contacts</span>
                {a.allowDuplicates === null ? <Badge>Setting not shown by the platform</Badge> : a.allowDuplicates ? <Badge tone="bad">Duplicates allowed</Badge> : <Badge tone="good">Blocking duplicates</Badge>}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          To block new duplicates in a client account: open it, go to Settings, then Business Profile (General), and switch off &quot;Allow Duplicate Contact&quot;. Do this for every account that shows exact matches above.
          {s.crossAccount > 0 && ` The ${fmtInt(s.crossAccount)} people who appear in more than one client account are not duplicates: each client owns its own customers. See Leads for that list.`}
        </p>
      </Card>

      {data.canReview && data.groups.some((g) => !g.review) && (
        <Card title="Bulk actions (preview first)" className="mb-6">
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">Groups with confidence</span>
              <select className="rounded-lg border bg-background px-3 py-2" value={range} onChange={(e) => { setRange(e.target.value as typeof range); setPreview(null); }}>
                <option value="high">90 to 100 (exact)</option>
                <option value="mid">75 to 89 (written differently)</option>
                <option value="low">Below 75 (weak hints)</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">Record this decision</span>
              <select className="rounded-lg border bg-background px-3 py-2" value={bulkAction} onChange={(e) => { setBulkAction(e.target.value as typeof bulkAction); setPreview(null); }}>
                <option value="keep">Accept the recommended record to keep</option>
                <option value="not_duplicate">These are not duplicates</option>
              </select>
            </label>
            <Btn disabled={busy} onClick={async () => { setBusy(true); try { setPreview(await api.post<Preview>("duplicates/bulk", bulkBody(true))); setMsg(null); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); } }}>Preview</Btn>
          </div>
          {preview && (
            <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{preview.count === 0 ? "Nothing matches this range." : `${preview.count} group${preview.count === 1 ? "" : "s"} (${fmtInt(preview.contacts)} contacts) would be recorded. Nothing in your contacts changes.`}</p>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {preview.sample.map((x, i) => <li key={i}>{x.locationName}: {x.names.join(" / ")} <span className="text-xs">({x.confidence}% · {x.reasons.join(", ")})</span></li>)}
              </ul>
              {preview.count > 0 && (
                <div className="mt-3"><Btn variant="primary" disabled={busy} onClick={() => run(() => api.post("duplicates/bulk", bulkBody(false)), `Recorded ${preview.count} decision${preview.count === 1 ? "" : "s"}. You can undo any of them below.`)}>
                  Confirm and record {preview.count}
                </Btn></div>
              )}
            </div>
          )}
        </Card>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">Review queue</h2>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" className="size-4" checked={showReviewed} onChange={(e) => setShowReviewed(e.target.checked)} /> Show reviewed groups
        </label>
      </div>
      {data.truncated && <p className="mb-3 text-xs text-muted-foreground">This account is very large, so we are showing the biggest groups first.</p>}

      {data.groups.length === 0 ? (
        <Empty title="Nothing to review" body="No two contacts in the same account look like the same person, or you have reviewed them all." />
      ) : (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <input className="w-full max-w-xs rounded-lg border bg-card px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30" placeholder="Find a name or account" aria-label="Find a name or account" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
            <span className="text-xs text-muted-foreground">{fmtInt(rows.length)} name{rows.length === 1 ? "" : "s"} · {fmtInt(data.groups.length)} group{data.groups.length === 1 ? "" : "s"}</span>
          </div>
          {rows.length === 0 ? <Empty title="No match" body="Nothing in the queue matches that search." /> : (
          <ul className="divide-y rounded-xl border bg-card">
            {pageRows.map((row) => (
              <li key={row.key}>
                <button type="button" aria-expanded={!!open[row.key]} onClick={() => setOpen({ ...open, [row.key]: !open[row.key] })}
                  className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40">
                  <span className="min-w-0">
                    <span className="font-medium">{row.name}</span>
                    <span className="text-muted-foreground"> · {row.locationName ?? "Unnamed account"}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">{row.groups.length > 1 ? `${row.groups.length} groups, ` : ""}{row.records} records</span>
                    <Badge tone={tone(row.top)}>{row.top}% sure</Badge>
                    {row.reviewed > 0 && <Badge tone="good">{row.reviewed === row.groups.length ? "Reviewed" : `${row.reviewed} reviewed`}</Badge>}
                    <span aria-hidden className="text-muted-foreground">{open[row.key] ? "Hide" : "Review"}</span>
                  </span>
                </button>
                {open[row.key] && (
          <ul className="space-y-4 border-t bg-muted/20 p-3">
          {row.groups.map((g) => {
            const chosen = keep[g.key] ?? g.review?.keepContactId ?? g.survivorId;
            return (
              <li key={g.locationId + g.key} className="rounded-xl border bg-card p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="font-medium">{g.locationName ?? "Unnamed account"}</span>
                  <Badge tone={tone(g.confidence)}>{g.confidence}% sure</Badge>
                  <Badge>{KIND_LABEL[g.kind]}</Badge>
                  <span className="text-xs text-muted-foreground">{g.reasons.join(" · ")}</span>
                  {g.review && <Badge tone="good">{g.review.decision === "not_duplicate" ? "Marked not duplicates" : g.review.decision === "merged_in_platform" ? "Merged in the platform" : "Record to keep chosen"} {g.review.decidedAt ? timeAgo(g.review.decidedAt) : ""}</Badge>}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="w-28 py-1 pr-2 font-normal">{""}</th>
                        {g.people.map((p) => (
                          <th key={p.contactId} className="py-1 pr-3 font-normal">
                            <label className="flex items-center gap-2">
                              <input type="radio" name={g.locationId + g.key} className="size-4" checked={chosen === p.contactId} disabled={!data.canReview} onChange={() => setKeep({ ...keep, [g.key]: p.contactId })} />
                              <span className="font-medium text-foreground">{chosen === p.contactId ? "Keep this one" : "Merge into kept"}</span>
                              {p.contactId === g.survivorId && <Badge tone="info">Recommended</Badge>}
                            </label>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {([
                        ["Name", (p: Person) => p.name],
                        ["Email", (p: Person) => p.email ?? "none"],
                        ["Phone", (p: Person) => p.phone ?? "none"],
                        ["Tags", (p: Person) => (p.tags.length ? p.tags.join(", ") : "none")],
                        ["Added", (p: Person) => (p.createdAt ? timeAgo(p.createdAt) : "unknown")],
                        ["Last activity", (p: Person) => (p.lastActivityAt ? timeAgo(p.lastActivityAt) : "none")],
                        ["Deals", (p: Person) => `${p.openDeals} open · ${p.wonDeals} won`],
                        ["Conversation", (p: Person) => (p.hasConversation ? "yes" : "no")],
                      ] as Array<[string, (p: Person) => string]>).map(([label, get]) => (
                        <tr key={label}>
                          <td className="py-1.5 pr-2 text-xs text-muted-foreground">{label}</td>
                          {g.people.map((p) => <td key={p.contactId} className="py-1.5 pr-3">{get(p)}</td>)}
                        </tr>
                      ))}
                      <tr>
                        <td className="py-1.5 pr-2 text-xs text-muted-foreground">Open</td>
                        {g.people.map((p) => <td key={p.contactId} className="py-1.5 pr-3"><ExtLink href={p.url}>In the platform</ExtLink></td>)}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                  <p className="mb-1 font-medium text-foreground">After merging, the kept record should have:</p>
                  <ul className="grid gap-x-6 sm:grid-cols-2">
                    {g.plan.map((f) => <li key={f.field}><span className="capitalize">{f.field}</span>: {f.keep || "empty"}{f.others.length ? ` (also seen: ${f.others.join(", ")})` : ""}</li>)}
                  </ul>
                  <p className="mt-2">To merge: open the contact to keep, or select the contacts in the platform&apos;s Contacts list, and use its own Merge option. It keeps the history of both. SubSync cannot merge for you, because the platform offers no safe way to do it from outside.</p>
                </div>
                {data.canReview && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!g.review ? (
                      <>
                        <Btn disabled={busy} onClick={() => decide(g, "merged_in_platform", "Recorded as merged. Refresh after the next sync and it will drop off the list.")}>I merged these in the platform</Btn>
                        <Btn disabled={busy} onClick={() => decide(g, "keep", "Recorded your choice of record to keep.")}>Save this record to keep</Btn>
                        <Btn variant="ghost" disabled={busy} onClick={() => decide(g, "not_duplicate", "Marked as not duplicates. They will not be flagged again.")}>Not duplicates</Btn>
                      </>
                    ) : (
                      <Btn variant="ghost" disabled={busy} onClick={() => run(() => api.post("duplicates/undo", { locationId: g.locationId, key: g.key }), "Decision removed. The group is back in the queue.")}>Undo this decision</Btn>
                    )}
                  </div>
                )}
              </li>
            );
          })}
          </ul>
                )}
              </li>
            ))}
          </ul>
          )}
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-xs text-muted-foreground">Showing {at * PAGE + 1} to {Math.min(rows.length, at * PAGE + PAGE)} of {fmtInt(rows.length)}</span>
              <span className="flex gap-2">
                <Btn variant="secondary" disabled={at === 0} onClick={() => setPage(at - 1)}>Previous</Btn>
                <Btn variant="secondary" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>Next</Btn>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
