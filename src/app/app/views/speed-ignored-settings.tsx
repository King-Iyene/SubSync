"use client";

import { useState } from "react";
import { cleanIgnoredPref, effectivePref, type IgnoredPref } from "@/lib/analytics/ignored-leads-core";
import { useApiClient, useData } from "../session";
import { Btn, Card, inputClass } from "../ui";

// Settings, Targets: when to be told that a client account is not answering its leads. One company-wide choice and, if wanted, one per client account (an account's own choice wins).
// Quiet hours, Slack and the daily brief are the ones already in Notifications; "count automatic messages as a reply" is the switch just above, in Speed to lead.
export function IgnoredLeadsSettings() {
  const api = useApiClient();
  const prefs = useData<{ ready: boolean; prefs: Record<string, unknown> }>("speed/prefs");
  const accounts = useData<{ accounts?: Array<{ locationId: string; name: string }> }>("speed?part=ignored");
  const [scope, setScope] = useState("");
  const [edit, setEdit] = useState<{ scope: string; v: IgnoredPref } | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const stored = prefs.data?.prefs;
  const saved: IgnoredPref = scope ? effectivePref(stored?.["|ignored"], stored?.[`${scope}|ignored`]) : cleanIgnoredPref(stored?.["|ignored"]);
  const form = edit && edit.scope === scope ? edit.v : saved;
  const setForm = (v: IgnoredPref) => { setEdit({ scope, v }); setState("idle"); };
  const save = async () => {
    setState("saving");
    try { await api.put("speed/prefs", { key: "ignored", scope, value: form }); prefs.reload(); setEdit(null); setState("saved"); } catch { setState("error"); }
  };
  const num = (k: "minPeople" | "waitHours") => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: Number(e.target.value) });
  const list = accounts.data?.accounts ?? [];
  return (
    <Card title="Clients not answering leads">
      <div data-testid="ignored-settings">
        <p className="mb-3 text-sm text-muted-foreground">SubSync tells you when a client account is not answering the leads sent to it: new leads nobody has called or messaged, customers who wrote and got no reply, and missed calls nobody returned. You are told once, and again only if it clears and happens again. SubSync never messages the leads or the client.</p>
        {list.length > 1 && (
          <div className="mb-3">
            <label htmlFor="ign-scope" className="mb-1 block text-sm font-medium">Apply to</label>
            <select id="ign-scope" className={`${inputClass} !w-64`} value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="">All client accounts</option>
              {list.map((a) => <option key={a.locationId} value={a.locationId}>{a.name} only</option>)}
            </select>
          </div>
        )}
        <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Tell me when {scope ? "this account is" : "an account is"} not answering its leads</label>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="ign-min" className="mb-1 block text-sm font-medium">Alert when this many people are waiting</label>
            <input id="ign-min" type="number" min={1} max={500} className={`${inputClass} !w-28`} value={form.minPeople} onChange={num("minPeople")} disabled={!form.enabled} />
          </div>
          <div>
            <label htmlFor="ign-wait" className="mb-1 block text-sm font-medium">A person counts after waiting (hours)</label>
            <input id="ign-wait" type="number" min={1} max={168} className={`${inputClass} !w-28`} value={form.waitHours} onChange={num("waitHours")} disabled={!form.enabled} />
          </div>
          <div>
            <label htmlFor="ign-to" className="mb-1 block text-sm font-medium">Who is told</label>
            <select id="ign-to" className={`${inputClass} !w-56`} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value === "account" ? "account" : "agency" })} disabled={!form.enabled}>
              <option value="agency">Me and my team (all accounts)</option>
              <option value="account">The client&apos;s own administrator</option>
            </select>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">It shows in your notifications and in the 7 am brief. Quiet hours, Slack and email follow your choices under Alerts and notifications; Slack and email stay in test mode until they are switched on. An automatic message counts as an answer only if you tick &quot;Count automatic messages as a reply&quot; above.</p>
        <div className="mt-3 flex items-center gap-3">
          <Btn variant="primary" onClick={() => void save()} disabled={state === "saving"} testId="ignored-save">{state === "saving" ? "Saving..." : "Save"}</Btn>
          {state === "saved" && <span className="text-sm text-muted-foreground" role="status">Saved.</span>}
          {state === "error" && <span className="text-sm text-destructive" role="alert">Could not save. Try again.</span>}
        </div>
      </div>
    </Card>
  );
}
