"use client";

import { useState } from "react";
import { useApiClient, useData } from "../session";
import { Badge, Btn, Card, Empty, ErrorBox, fmtInt, inputClass, Loading, PageHeader, Table, Td, Th, timeAgo } from "../ui";

type Run = {
  id: string; locationId: string; locationName: string | null; status: string; total: number; applied: number; skipped: number; failed: number; undone: number;
  truncated: boolean; note: string | null; createdAt: string | null; params: { rules: string[] };
};
type Change = { contactId: string; name: string; rule: string; field: string; before: string | null; after: string | null; tag: string | null; status: string; error: string | null };
type Data = { runs: Run[]; canWrite: boolean; accounts: Array<{ locationId: string; name: string }>; writeNote: string | null; previewValidHours: number };
type Preview = { runId: string; total: number; truncated: boolean; scanned: number; summary: { phone: number; name: number; tagAdd: number; tagRemove: number; contacts: number } };

const STATUS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "info" | "neutral" }> = {
  previewed: { label: "Preview only", tone: "neutral" }, applying: { label: "Applying", tone: "info" }, applied: { label: "Applied", tone: "good" }, partial: { label: "Applied, some skipped", tone: "warn" },
  undoing: { label: "Undoing", tone: "info" }, undone: { label: "Undone", tone: "neutral" }, needs_permission: { label: "Needs permission", tone: "warn" }, failed: { label: "Failed", tone: "bad" },
};

export function CleanupView() {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<Data>("cleanup");
  const [account, setAccount] = useState("");
  const [phone, setPhone] = useState(true);
  const [name, setName] = useState(true);
  const [tag, setTag] = useState(false);
  const [cc, setCc] = useState("");
  const [tagAction, setTagAction] = useState<"add" | "remove">("add");
  const [tagName, setTagName] = useState("");
  const [missing, setMissing] = useState("");
  const [idle, setIdle] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [detail, setDetail] = useState<{ run: Run; changes: Change[] } | null>(null);
  const [confirm, setConfirm] = useState("");

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const chosen = account || data.accounts[0]?.locationId || "";

  const open = async (id: string) => setDetail(await api.get<{ run: Run; changes: Change[] }>(`cleanup/${id}`));
  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const makePreview = () => guard(async () => {
    const rules = [phone && "phone", name && "name", tag && "tag"].filter(Boolean);
    const body = {
      locationId: chosen, rules, defaultCountryCode: cc || null,
      tag: tag ? { action: tagAction, name: tagName, where: { ...(missing ? { missing } : {}), ...(idle ? { idleDays: Number(idle) } : {}) } } : undefined,
    };
    const made = await api.post<Preview>("cleanup/preview", body);
    setPreview(made);
    setConfirm("");
    await open(made.runId);
    await reload();
  });

  // Work in slices until finished, so a long run never depends on one request.
  const run = (mode: "apply" | "undo", id: string) => guard(async () => {
    let finished = false;
    let first = true;
    while (!finished) {
      const r = await api.post<{ run: Run; finished: boolean }>(`cleanup/${id}/${mode}`, first ? { confirm: Number(confirm) } : {});
      first = false;
      finished = r.finished;
      setDetail((d) => (d ? { ...d, run: r.run } : d));
      if (r.run.status === "needs_permission") finished = true;
    }
    await open(id);
    await reload();
    setMsg({ ok: true, text: mode === "apply" ? "Done. Every change is listed below and can be undone." : "Undone: the original values were put back." });
  });

  const d = detail;
  const st = d ? STATUS[d.run.status] ?? STATUS.failed : null;

  return (
    <div>
      <PageHeader title="Data cleanup" subtitle="Tidy phone numbers and names, or add and remove a tag in bulk. You always see the exact changes first, confirm the number, and can undo the whole run afterwards." />
      {data.writeNote && <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="note">{data.writeNote}</p>}
      {msg && <p className={`mb-4 rounded-lg border px-3 py-2 text-sm ${msg.ok ? "bg-muted/40" : "border-red-300 bg-red-50 text-red-800"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}

      <Card title="1. Choose what to tidy" className="mb-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {data.accounts.length > 1 && (
            <div>
              <label htmlFor="cl-acct" className="mb-1 block text-sm font-medium">Client account</label>
              <select id="cl-acct" className={inputClass} value={chosen} onChange={(e) => { setAccount(e.target.value); setPreview(null); setDetail(null); }}>{data.accounts.map((a) => <option key={a.locationId} value={a.locationId}>{a.name}</option>)}</select>
              <p className="mt-1 text-xs text-muted-foreground">One account at a time, so nothing is ever changed across clients by accident.</p>
            </div>
          )}
          <div className="space-y-3 text-sm md:col-span-2">
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 size-4" checked={phone} onChange={(e) => setPhone(e.target.checked)} /><span><strong>Standard phone numbers</strong>: write every number as +digits.</span></label>
            {phone && (
              <div className="ml-6 max-w-xs">
                <label htmlFor="cl-cc" className="mb-1 block text-xs text-muted-foreground">Country code for numbers without one (optional)</label>
                <input id="cl-cc" className={inputClass} placeholder="+1 or +234" value={cc} onChange={(e) => setCc(e.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">Left blank, a number with no country code is left alone rather than guessed.</p>
              </div>
            )}
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 size-4" checked={name} onChange={(e) => setName(e.target.checked)} /><span><strong>Fix names</strong>: only those typed entirely in CAPITALS or lower case. Names like McDonald are left alone.</span></label>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 size-4" checked={tag} onChange={(e) => setTag(e.target.checked)} /><span><strong>Add or remove a tag</strong> for the contacts that match a filter.</span></label>
            {tag && (
              <div className="ml-6 grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div><label className="mb-1 block text-xs text-muted-foreground">Action</label><select className={inputClass} value={tagAction} onChange={(e) => setTagAction(e.target.value as "add" | "remove")}><option value="add">Add</option><option value="remove">Remove</option></select></div>
                <div><label className="mb-1 block text-xs text-muted-foreground">Tag</label><input className={inputClass} maxLength={60} value={tagName} onChange={(e) => setTagName(e.target.value)} placeholder="No email" /></div>
                <div><label className="mb-1 block text-xs text-muted-foreground">Who</label><select className={inputClass} value={missing} onChange={(e) => setMissing(e.target.value)}><option value="">Anyone matching below</option><option value="email">No email</option><option value="phone">No phone</option><option value="either">No email or no phone</option></select></div>
                <div><label className="mb-1 block text-xs text-muted-foreground">Idle for (days)</label><input className={inputClass} inputMode="numeric" value={idle} onChange={(e) => setIdle(e.target.value)} placeholder="90" /></div>
                <p className="text-xs text-muted-foreground sm:col-span-4">A tag always needs a filter: it is never applied to everyone at once.</p>
              </div>
            )}
          </div>
        </div>
        <div className="mt-4"><Btn variant="primary" disabled={busy || !chosen || (!phone && !name && !tag)} onClick={makePreview}>{busy ? "Working..." : "Preview the changes"}</Btn></div>
      </Card>

      {d && (
        <Card title="2. Review, confirm, apply" className="mb-6" action={st ? <Badge tone={st.tone}>{st.label}</Badge> : undefined}>
          <p className="mb-2 text-sm">
            <strong>{fmtInt(d.run.total)}</strong> change{d.run.total === 1 ? "" : "s"} planned in <strong>{d.run.locationName ?? "this account"}</strong>
            {preview ? `, from ${fmtInt(preview.scanned)} contacts (${preview.summary.contacts} would be touched)` : ""}.
            {d.run.truncated && " The plan was capped at 5,000 changes: run it again afterwards for the rest."}
          </p>
          {preview && <p className="mb-3 text-xs text-muted-foreground">{preview.summary.phone} phone numbers · {preview.summary.name} name fixes · {preview.summary.tagAdd} tags to add · {preview.summary.tagRemove} tags to remove.</p>}
          {d.changes.length === 0 ? <Empty title="Nothing to change" body="Everything in this account already looks the way these rules would leave it." /> : (
            <Table head={<tr><Th>Contact</Th><Th>Change</Th><Th>Before</Th><Th>After</Th><Th>Result</Th></tr>}>
              {d.changes.map((c) => (
                <tr key={c.contactId + c.field + (c.tag ?? "")}>
                  <Td className="font-medium">{c.name}</Td>
                  <Td>{c.rule === "tag" ? `${c.after === "with" ? "Add" : "Remove"} tag "${c.tag}"` : c.field === "phone" ? "Phone" : c.field === "firstName" ? "First name" : "Last name"}</Td>
                  <Td className="text-muted-foreground">{c.rule === "tag" ? (c.before === "with" ? "has the tag" : "no tag") : c.before ?? "empty"}</Td>
                  <Td>{c.rule === "tag" ? (c.after === "with" ? "has the tag" : "no tag") : c.after ?? "empty"}</Td>
                  <Td>{c.status === "pending" ? "" : <Badge tone={c.status === "applied" ? "good" : c.status === "failed" ? "bad" : "neutral"}>{c.status}</Badge>}{c.error ? <span className="ml-1 text-xs text-muted-foreground">{c.error}</span> : null}</Td>
                </tr>
              ))}
            </Table>
          )}
          {d.run.total > d.changes.length && <p className="mt-2 text-xs text-muted-foreground">Showing the first {d.changes.length} of {fmtInt(d.run.total)}. Every one is saved with its original value.</p>}

          {(d.run.status === "previewed" || d.run.status === "needs_permission") && d.run.total > 0 && (
            <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="font-medium">This will change {fmtInt(d.run.total)} contact value{d.run.total === 1 ? "" : "s"} in your client&apos;s account.</p>
              <p className="mt-1 text-xs text-muted-foreground">Each contact is checked again just before it is changed, and skipped if someone edited it since this preview. The original values are saved so you can undo.</p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div><label htmlFor="cl-confirm" className="mb-1 block text-xs text-muted-foreground">Type {d.run.total} to confirm</label><input id="cl-confirm" className={`${inputClass} w-32`} inputMode="numeric" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
                <Btn variant="primary" disabled={busy || Number(confirm) !== d.run.total || !data.canWrite} onClick={() => run("apply", d.run.id)}>{busy ? "Applying..." : `Apply ${fmtInt(d.run.total)} changes`}</Btn>
                {!data.canWrite && <span className="text-xs text-amber-800">Needs the contact edit permission first.</span>}
              </div>
            </div>
          )}
          {d.run.note && <p className="mt-3 text-sm text-amber-900">{d.run.note}</p>}
          {(d.run.status === "applied" || d.run.status === "partial" || d.run.status === "applying" || d.run.status === "undoing") && (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <span>{d.run.applied} applied · {d.run.skipped} skipped (changed since the preview or already done) · {d.run.failed} failed{d.run.undone ? ` · ${d.run.undone} undone` : ""}</span>
              {d.run.applied > 0 && <Btn disabled={busy} onClick={() => run("undo", d.run.id)}>{busy ? "Working..." : "Undo this run"}</Btn>}
            </div>
          )}
        </Card>
      )}

      <Card title="Past runs">
        {data.runs.length === 0 ? <p className="text-sm text-muted-foreground">No clean-ups yet.</p> : (
          <ul className="divide-y text-sm">
            {data.runs.map((r) => {
              const s = STATUS[r.status] ?? STATUS.failed;
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><span className="font-medium">{r.locationName ?? "Account"}</span> <span className="text-muted-foreground">· {r.params.rules.join(", ")} · {fmtInt(r.total)} change{r.total === 1 ? "" : "s"} · {timeAgo(r.createdAt)}</span></span>
                  <span className="flex items-center gap-3"><Badge tone={s.tone}>{s.label}</Badge><button type="button" className="text-xs underline" onClick={() => { setPreview(null); void open(r.id); }}>Open</button></span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
