"use client";

import { useState } from "react";
import { useApiClient, useData } from "../session";

// "Set up call queue" (docs/features/WORKFLOW_SETUP.md). SubSync can create the workflow in your CRM for you when your CRM allows it; when it does not, the same five steps are
// shown to do by hand. Nothing is created until you confirm, and with writing switched off the answer is "Would create ...".
type View = { ready: boolean; state: "none" | "active" | "created_draft" | "unavailable" | "inactive"; workflowId: string | null; updateAvailable: boolean; lastError: string | null; live: boolean; tag: string; folderDefault: string; users: Array<{ id: string; name: string }>; canEdit?: boolean; settings: { folderName: string; autoSetup: boolean; assignMode: "round_robin" | "user"; assignUserId: string | null } };
type Out = { state: string; message: string };

export const GUIDE_FOLDER_DEFAULT = "Lead Response Automations";

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="s6-link ml-2 text-xs" aria-label={`Copy ${label}`} onClick={() => { void navigator.clipboard?.writeText(text).then(() => setDone(true)).catch(() => setDone(false)); }}>{done ? "Copied" : "Copy"}</button>;
}

export function WorkflowSetupCard({ loc, canEdit, tag }: { loc: string; canEdit: boolean; tag: string }) {
  const api = useApiClient();
  const v = useData<View>(loc ? `dial/cq-wf?locationId=${encodeURIComponent(loc)}` : null);
  const [out, setOut] = useState<Out | null>(null);
  const [busy, setBusy] = useState(false);
  const [guide, setGuide] = useState(false);
  const d = v.data;
  const folder = d?.settings.folderName ?? GUIDE_FOLDER_DEFAULT;
  const setupDone = d?.state === "active";
  const fell = out?.state === "unavailable" || d?.state === "unavailable";

  async function run(path: string, body: Record<string, unknown>) {
    setBusy(true);
    try { const r = await api.post<Out>(path, { locationId: loc, ...body }); setOut(r); if (r.state === "unavailable") setGuide(true); await v.reload(); }
    catch { setOut({ state: "failed", message: "Could not reach your CRM just now. Nothing was changed." }); } finally { setBusy(false); }
  }
  async function save(p: Record<string, unknown>) {
    try { await api.put("dial/cq-wf-settings", { locationId: loc, ...p }); await v.reload(); } catch { setOut({ state: "failed", message: "Could not save that. Use a plain name without the product or platform name." }); }
  }

  return (
    <div className="mb-3" data-testid="wf-setup">
      <p className="font-medium" data-testid="wf-setup-state">
        {!d ? "Loading..." : setupDone ? "Your call queue workflow is set up." : d.state === "created_draft" ? "The workflow was created but is not published yet." : "The call queue workflow is not set up yet."}
        {d?.updateAvailable && <span className="s6-label ml-2" data-testid="wf-update">Update available. Your workflow was left exactly as it is.</span>}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" className="s6-btn" data-kind="primary" data-testid="wf-setup-run" disabled={busy || !canEdit || !d?.ready || setupDone} onClick={() => void run("dial/cq-wf-setup", { confirm: true })}>Set up call queue</button>
        <button type="button" className="s6-btn" data-testid="wf-setup-check" disabled={busy} onClick={() => void run("dial/cq-wf-check", {})}>Check setup</button>
        <button type="button" className="s6-link text-sm" data-testid="wf-guide-open" onClick={() => setGuide(!guide)}>{guide ? "Hide the steps" : "Do it yourself in 5 steps"}</button>
      </div>
      <p className="s6-label mt-1">One folder and one workflow are created in your CRM, only when you press the button, and are never changed or deleted afterwards.{d && !d.live ? " Writing to your CRM is off for this account, so pressing it only shows what would be created." : ""}</p>
      {d && canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2"><span className="s6-label">Folder name</span><input aria-label="Folder name" data-testid="wf-folder" className="min-h-9 rounded-md border bg-card px-2" defaultValue={folder} onBlur={(e) => { const x = e.target.value.trim(); if (x !== folder) void save({ folderName: x === d.folderDefault ? "" : x }); }} /></label>
          <label className="flex items-center gap-2"><span className="s6-label">Calls go to</span>
            <select aria-label="Calls go to" className="min-h-9 rounded-md border bg-card px-2" value={d.settings.assignMode === "user" && d.settings.assignUserId ? d.settings.assignUserId : "round_robin"} onChange={(e) => void save(e.target.value === "round_robin" ? { assignMode: "round_robin" } : { assignMode: "user", assignUserId: e.target.value })}>
              <option value="round_robin">Everyone in turn (round robin)</option>
              {d.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select></label>
          <label className="flex items-center gap-2"><button type="button" role="switch" aria-checked={d.settings.autoSetup} aria-label="Set up automatically when installed" className="s6-toggle" onClick={() => void save({ autoSetup: !d.settings.autoSetup })} /><span className="s6-label">Set up automatically when a client account is added</span></label>
        </div>
      )}
      {out && <p className={`mt-2 ${fell ? "" : "font-medium"}`} role="status" data-testid="wf-setup-msg">{out.message}</p>}
      {(guide || fell) && (
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm" data-testid="wf-guide">
          <li>In your CRM, open Automation, then Workflows, and create a folder named <b>{folder}</b><Copy text={folder} label="folder name" /> (or use one you already have).</li>
          <li>Inside it, create a new workflow from scratch and name it <b>Call queue</b><Copy text="Call queue" label="workflow name" />.</li>
          <li>Add the trigger <b>Contact Tag</b>, set it to &quot;Tag added&quot;, and choose the tag <b>{tag}</b><Copy text={tag} label="tag" />.</li>
          <li>Add the action <b>Manual Action</b>, choose &quot;Call&quot;, and assign it to one person or to everyone in turn (not &quot;contact owner&quot;, new leads have none). Then add the action <b>Remove Contact Tag</b> with the same tag.</li>
          <li>Publish the workflow, then come back here and press <b>I did it</b>.
            <button type="button" className="s6-btn ml-2" data-testid="wf-did-it" disabled={busy} onClick={() => void run("dial/cq-wf-check", {})}>I did it</button></li>
        </ol>
      )}
    </div>
  );
}
