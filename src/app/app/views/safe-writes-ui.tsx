"use client";

import { useState } from "react";
import { useApiClient, useData } from "../session";
import { Badge, Btn, Card, inputClass } from "../ui";

// The previewed CRM changes (docs/WRITE_SCOPES_NO_SAFE_USE.md lists the permissions that have no safe use). Every change here is the same two steps: SubSync shows exactly what it would do
// (nothing is sent), then the person confirms. The server decides what the preview says and whether the change is allowed; this file only draws it. A delete asks for the name typed back.
type Mode = { masterOn: boolean; optedIn: boolean; live: boolean; demo: boolean };
type Preview = { title: string; lines: string[]; canConfirm: boolean; typeToConfirm?: string | null };
type PreviewAnswer = { ok: boolean; preview?: Preview; mode?: Mode; needsPermission?: boolean; message?: string };
type DoAnswer = { ok: boolean; message?: string; dryRun?: boolean; done?: boolean };

const modeNote = (m: Mode | null): string =>
  !m ? "" : m.demo ? "This is the demo, so nothing is sent." : m.live ? "Confirming changes your CRM." : m.masterOn ? "Not allowed for this account yet: confirming only shows what would happen. Nothing is sent." : "Changes from SubSync are switched off: confirming only shows what would happen. Nothing is sent.";

/** One button that opens a preview, then a confirm. `path` is the route under /api/app (sw/tag ...); `body` is what the server needs to find the thing (never a title or a value to trust). */
export function PreviewConfirm({ path, body, label, confirmLabel = "Confirm", variant = "secondary", testId, onDone }: {
  path: string; body: Record<string, unknown>; label: string; confirmLabel?: string; variant?: "primary" | "secondary" | "ghost"; testId: string; onDone?: () => void;
}) {
  const api = useApiClient();
  const [state, setState] = useState<"idle" | "loading" | "preview" | "sending" | "done">("idle");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [perm, setPerm] = useState(false);

  const open = async () => {
    setState("loading"); setNote(null); setTyped("");
    try {
      const r = await api.post<PreviewAnswer>(path, { ...body, step: "preview" });
      if (!r.preview) { setNote({ ok: false, text: r.message ?? "Could not prepare this change." }); setState("idle"); return; }
      setPreview(r.preview); setMode(r.mode ?? null); setPerm(r.needsPermission === true); setState("preview");
    } catch (e) { setNote({ ok: false, text: e instanceof Error && e.message ? e.message : "Could not prepare this change." }); setState("idle"); }
  };
  const confirm = async () => {
    setState("sending");
    try {
      const r = await api.post<DoAnswer>(path, { ...body, step: "do", confirmed: true, confirmText: typed });
      setNote({ ok: true, text: r.message ?? "Done." }); setState("done");
      if (r.done) onDone?.();
    } catch (e) { setNote({ ok: false, text: e instanceof Error && e.message ? e.message : "That did not work. Nothing was changed." }); setState("preview"); }
  };
  const needsName = !!preview?.typeToConfirm;
  const nameOk = !needsName || typed.trim().toLowerCase() === (preview?.typeToConfirm ?? "").trim().toLowerCase();

  return (
    <div className="space-y-2" data-testid={`${testId}-flow`}>
      {(state === "idle" || state === "loading" || state === "done") && <Btn variant={variant} disabled={state === "loading"} onClick={() => void open()} testId={testId}>{state === "loading" ? "Checking..." : label}</Btn>}
      {(state === "preview" || state === "sending") && preview && (
        <div className="rounded-lg border p-3" data-testid={`${testId}-preview`}>
          <p className="text-sm font-medium">{preview.title}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">{preview.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          <p className="mt-1 text-xs text-muted-foreground">{modeNote(mode)}</p>
          {perm && <p className="mt-1 text-xs text-destructive" role="alert">Needs permission: reconnect SubSync to allow this change.</p>}
          {needsName && (
            <label className="mt-2 block text-sm"><span className="text-xs text-muted-foreground">Type the name to confirm</span>
              <input aria-label="Type the name to confirm" className={`${inputClass} mt-1`} value={typed} maxLength={200} onChange={(e) => setTyped(e.target.value)} />
            </label>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn variant="primary" disabled={state === "sending" || !preview.canConfirm || !nameOk} onClick={() => void confirm()} testId={`${testId}-confirm`}>{state === "sending" ? "Working..." : confirmLabel}</Btn>
            <Btn disabled={state === "sending"} onClick={() => { setState("idle"); setPreview(null); }}>Cancel</Btn>
          </div>
        </div>
      )}
      {note && <p className={`border-l-2 py-1 pl-3 text-sm ${note.ok ? "border-success" : "border-destructive"}`} role={note.ok ? "status" : "alert"} data-testid={`${testId}-note`}>{note.text}</p>}
    </div>
  );
}

/** Beside a call queue tag the account does not have yet. */
export function CreateTagButton({ locationId, name, onDone }: { locationId: string; name: string; onDone?: () => void }) {
  return <PreviewConfirm path="sw/tag" body={{ locationId, name }} label="Create this tag" confirmLabel="Create the tag" testId="sw-tag" onDone={onDone} />;
}

type Setup = {
  canEdit: boolean; mode: Mode;
  pipeline: { show: boolean; known: boolean; name: string; stages: string[]; needsPermission: boolean };
  sla: { minutes: number; name: string; needsPermission: boolean };
};

/** Settings, Call queues: the two optional one-time set-up changes for one account. Both are previewed first. */
export function CrmSetupCard({ locationId }: { locationId: string }) {
  const d = useData<Setup>(locationId ? `sw/setup?locationId=${encodeURIComponent(locationId)}` : null);
  const s = d.data;
  if (!s || !s.canEdit) return null;
  return (
    <Card title="Set up your CRM (optional)">
      <p className="text-sm text-muted-foreground">Two one-time changes SubSync can make for you. Each one shows exactly what it will do before anything happens.</p>
      <div className="mt-3 space-y-4">
        <div data-testid="sw-sla-block">
          <p className="text-sm font-medium">Share your reply target with your workflows</p>
          <p className="text-xs text-muted-foreground">SubSync keeps your reply target ({s.sla.minutes} minutes) in a CRM value called <strong className="font-medium">{s.sla.name}</strong>, so your own workflows can use the same number.</p>
          <div className="mt-2"><PreviewConfirm path="sw/sla" body={{ locationId }} label="Save my reply target" confirmLabel="Save it" testId="sw-sla" /></div>
        </div>
        {s.pipeline.show && (
          <div className="border-t pt-3" data-testid="sw-pipeline-block">
            <p className="text-sm font-medium">This account has no pipeline yet</p>
            <p className="text-xs text-muted-foreground">SubSync can make the standard sales pipeline, <strong className="font-medium">{s.pipeline.name}</strong>: {s.pipeline.stages.join(", ")}.</p>
            <div className="mt-2"><PreviewConfirm path="sw/pipeline" body={{ locationId }} label="Create the standard sales pipeline" confirmLabel="Create the pipeline" testId="sw-pipeline" onDone={() => void d.reload()} /></div>
          </div>
        )}
        {!s.pipeline.show && s.pipeline.known && <p className="border-t pt-3 text-xs text-muted-foreground" data-testid="sw-pipeline-have"><Badge tone="good">Pipeline found</Badge> This account already has a pipeline, so SubSync adds nothing.</p>}
      </div>
    </Card>
  );
}

/** On a task in the lead panel: mark done, and (only for a task SubSync made) delete with the name typed back. */
export function TaskActions({ locationId, contactId, taskId, done, ours, canDelete, onDone }: { locationId: string; contactId: string; taskId: string; done: boolean; ours: boolean; canDelete: boolean; onDone: () => void }) {
  return (
    <div className="flex w-full flex-wrap gap-2" data-testid="sw-task-actions">
      {!done && <PreviewConfirm path="sw/task" body={{ locationId, contactId, taskId, op: "complete" }} label="Mark done" confirmLabel="Mark done" testId="sw-task-done" onDone={onDone} />}
      {ours && canDelete && <PreviewConfirm path="sw/task" body={{ locationId, contactId, taskId, op: "delete" }} label="Delete" confirmLabel="Delete the task" testId="sw-task-delete" onDone={onDone} />}
    </div>
  );
}
