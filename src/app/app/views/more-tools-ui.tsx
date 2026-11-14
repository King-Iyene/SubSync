"use client";

import { useState } from "react";
import { localDay } from "@/lib/design/zone";
import { useData } from "../session";
import { Badge, Card, inputClass } from "../ui";
import { PreviewConfirm } from "./safe-writes-ui";

// More tools (docs/features/MORE_TOOLS.md). Every change is the same two steps as the other safe writes: a preview of exactly what would happen, then a confirm. The server decides what the
// preview says; these cards only draw it and collect what a person types. Nothing here messages a lead, and nothing is sent: quotes and invoices are only saved.

type Templates = { ok?: boolean; templates: Array<{ id: string; name: string; type: string; updatedAt: string | null }>; folders: number; plainText: number; truncated: boolean; stale: number; message?: string; needsPermission?: boolean };
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

/** Account setup: the account's email templates, names and dates only (read live, never stored). */
export function EmailTemplatesCard({ locationId }: { locationId: string }) {
  const d = useData<Templates>(locationId ? `mt/templates?locationId=${encodeURIComponent(locationId)}` : null);
  return (
    <Card title="Email templates">
      <div data-testid="mt-templates">
        {d.loading && !d.data && <p className="text-sm text-muted-foreground">Reading your email templates...</p>}
        {d.error && <p className="text-sm text-muted-foreground" role="status">{d.error.message || "Needs permission: reconnect SubSync to read your email templates."}</p>}
        {d.data && (
          <>
            <p className="text-sm" data-testid="mt-templates-count"><span className="text-lg font-semibold tabular-nums">{d.data.templates.length}{d.data.truncated ? "+" : ""}</span> {d.data.templates.length === 1 ? "template" : "templates"}{d.data.folders > 0 ? `, ${d.data.folders} ${d.data.folders === 1 ? "folder" : "folders"}` : ""}.
              {d.data.stale > 0 && <> <Badge tone="warn">{d.data.stale} not edited for a year</Badge></>}</p>
            {d.data.templates.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">No email templates yet. Next: build one in your CRM so follow-ups are written once.</p> : (
              <ul className="mt-2 divide-y text-sm">{d.data.templates.slice(0, 20).map((t) => <li key={t.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span className="min-w-0 truncate font-medium">{t.name}</span><span className="text-xs text-muted-foreground">{day(t.updatedAt)}</span></li>)}</ul>
            )}
            <p className="mt-2 text-xs text-muted-foreground">Names and dates only. SubSync never copies what is inside a template.</p>
          </>
        )}
      </div>
    </Card>
  );
}

type Pipes = { canEdit: boolean; pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }> };

/** Account setup: rename one pipeline stage. SubSync reads the pipeline just before and sends back every stage unchanged except the one name. */
export function StageRenameCard({ locationId }: { locationId: string }) {
  const d = useData<Pipes>(locationId ? `mt/pipelines?locationId=${encodeURIComponent(locationId)}` : null);
  const [pipelineId, setPipelineId] = useState("");
  const [stageId, setStageId] = useState("");
  const [newName, setNewName] = useState("");
  const p = d.data;
  if (!p || !p.canEdit || p.pipelines.length === 0) return null;
  const pipe = p.pipelines.find((x) => x.id === pipelineId) ?? p.pipelines[0];
  const stage = pipe.stages.find((s) => s.id === stageId) ?? pipe.stages[0];
  return (
    <Card title="Rename a pipeline stage">
      <div data-testid="mt-stage" className="space-y-2">
        <p className="text-sm text-muted-foreground">Change the name of one stage. Stage order stays the same and no deal moves.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-sm"><span className="text-xs text-muted-foreground">Pipeline</span>
            <select className={`${inputClass} mt-1`} value={pipe.id} onChange={(e) => { setPipelineId(e.target.value); setStageId(""); }} aria-label="Pipeline">{p.pipelines.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="text-sm"><span className="text-xs text-muted-foreground">Stage</span>
            <select className={`${inputClass} mt-1`} value={stage?.id ?? ""} onChange={(e) => setStageId(e.target.value)} aria-label="Stage">{pipe.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label className="text-sm"><span className="text-xs text-muted-foreground">New name</span>
            <input className={`${inputClass} mt-1`} value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} aria-label="New stage name" /></label>
        </div>
        {stage && newName.trim() && <PreviewConfirm path="mt/stage" body={{ locationId, pipelineId: pipe.id, stageId: stage.id, newName }} label="Preview the rename" confirmLabel="Rename the stage" testId="mt-stage-go" onDone={() => { setNewName(""); void d.reload(); }} />}
      </div>
    </Card>
  );
}

/** Lead panel: a repeating follow-up task on this contact (ends by itself), and unsent quotes or invoices. */
export function FollowUpTools({ locationId, contactId, canBill }: { locationId: string; contactId: string; canBill: boolean }) {
  const [today] = useState(() => localDay(Date.now()));
  const [title, setTitle] = useState("");
  const [every, setEvery] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [count, setCount] = useState("4");
  const [start, setStart] = useState(today);
  const [name, setName] = useState("");
  const [item, setItem] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"estimate" | "invoice" | "template">("estimate");
  return (
    <div className="space-y-5" data-testid="mt-tools">
      <div className="space-y-2" data-testid="mt-repeat">
        <p className="text-sm font-medium">Repeating follow-up</p>
        <p className="text-xs text-muted-foreground">Your CRM creates this task on a schedule and it stops after the last repeat. Nothing is sent to the contact.</p>
        <div className="grid gap-2 sm:grid-cols-4">
          <input className={`${inputClass} sm:col-span-4`} placeholder="What to follow up on" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} aria-label="What to follow up on" />
          <select className={inputClass} value={every} onChange={(e) => setEvery(e.target.value as "daily" | "weekly" | "monthly")} aria-label="How often"><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option></select>
          <input className={inputClass} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} aria-label="Number of times" />
          <input className={`${inputClass} sm:col-span-2`} type="date" value={start} min={today} onChange={(e) => setStart(e.target.value)} aria-label="Start date" />
        </div>
        {title.trim() && <PreviewConfirm path="mt/repeat" body={{ locationId, contactId, followUp: { title, intervalType: every, interval: 1, count: Number(count), startDate: start, dueAfterHours: 24 } }} label="Preview the follow-up" confirmLabel="Save the follow-up" testId="mt-repeat-go" />}
      </div>
      {canBill && (
        <div className="space-y-2 border-t pt-4" data-testid="mt-draft">
          <p className="text-sm font-medium">Quote or invoice (saved, not sent)</p>
          <p className="text-xs text-muted-foreground">SubSync saves one line in your CRM. You check it there and send it yourself.</p>
          <div className="grid gap-2 sm:grid-cols-4">
            <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as "estimate" | "invoice" | "template")} aria-label="What to save"><option value="estimate">Estimate</option><option value="invoice">Invoice</option><option value="template">Invoice template</option></select>
            <input className={inputClass} placeholder="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Name" />
            <input className={inputClass} placeholder="What it is for" value={item} maxLength={80} onChange={(e) => setItem(e.target.value)} aria-label="What it is for" />
            <input className={inputClass} placeholder="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
          </div>
          {name.trim() && item.trim() && amount.trim() && <PreviewConfirm path="mt/draft" body={{ locationId, contactId, kind, draft: { name, itemName: item, amount, qty: 1, currency: "USD" } }} label="Preview" confirmLabel="Save it" testId="mt-draft-go" />}
        </div>
      )}
    </div>
  );
}

type Installer = { ok?: boolean; planId: string | null; recordedPlanId: string | null; matches: boolean | null; isWhitelabel: boolean | null; installedAt: string | null; message?: string };

/** Clients > Money and plans: what the platform's own install record says about SubSync for this company. */
export function InstallerCard() {
  const d = useData<Installer>("mt/installer");
  if (d.error && /company owners/.test(d.error.message ?? "")) return null;
  return (
    <section className="cl-drill" aria-label="Install record" data-testid="mt-installer">
      <h3 className="mb-1 text-base font-semibold">Install record</h3>
      {d.loading && !d.data && <p className="text-sm text-muted-foreground">Reading the install record...</p>}
      {d.error && <p className="text-sm text-muted-foreground" role="status">{d.error.message || "Not available from the platform yet."}</p>}
      {d.data && (
        <p className="text-sm" data-testid="mt-installer-line">
          Plan on the platform record: <strong>{d.data.planId ?? "not given"}</strong>
          {d.data.matches === true && <> <Badge tone="good">Matches SubSync</Badge></>}
          {d.data.matches === false && <> <Badge tone="warn">Differs from what SubSync recorded</Badge></>}
          {d.data.installedAt ? `. Installed ${day(d.data.installedAt)}` : ""}.
        </p>
      )}
    </section>
  );
}
