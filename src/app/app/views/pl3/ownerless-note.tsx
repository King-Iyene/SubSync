"use client";

import { useState } from "react";
import { useApiClient, useData } from "../../session";
import { money } from "./format";
import { ownerlessNote } from "./pipe-list";

// "19 deals without an owner (not counted in money): assign owners in your CRM or tap Count them." One tap opens a preview (how many deals and how much money across the company), then one confirm saves the
// company setting (Settings, Targets, Deal rules) with the same permissions and audit as the test-names switch. Nothing in the CRM changes. Every state renders words: no silent click.
type Got = { countOwnerless: boolean; canChange: boolean; preview: { deals: number; dollars: number } | null };
const n = (v: number) => v.toLocaleString("en-US");

export function OwnerlessNote({ count, counted, testId = "pl-ownerless" }: { count: number; counted: boolean; testId?: string }) {
  const note = ownerlessNote(count, counted);
  const api = useApiClient();
  const got = useData<Got>(note ? "deal-rules/ownerless" : null);
  const [ask, setAsk] = useState(false), [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  if (!note) return null;
  const turnOn = !counted, can = got.data?.canChange === true, pv = got.data?.preview ?? null;
  const save = async () => {
    setState("saving");
    try { await api.put("deal-rules/ownerless", { countOwnerless: turnOn }); setState("saved"); setTimeout(() => { if (typeof window !== "undefined") window.location.reload(); }, 900); } catch { setState("error"); }
  };
  return (
    <div className="mb-2" data-testid={testId} role="status">
      <p className="ap-fine">{note.text}{note.action && can && !ask && state === "idle" && <>{" "}<button type="button" className="ap-link" onClick={() => setAsk(true)} data-testid={`${testId}-toggle`}>{turnOn ? "Count them" : "Leave them out"}</button></>}</p>
      {note.action && got.data && !can && <p className="ap-fine" data-testid={`${testId}-readonly`}>Only the company owner or an administrator can change this.</p>}
      {got.error && <p className="ap-fine" role="alert">Could not check who can change this. <button type="button" className="ap-link" onClick={got.reload}>Try again</button></p>}
      {ask && state !== "saved" && (
        <div className="ap-fine mt-1" data-testid={`${testId}-preview`}>
          <p>{turnOn
            ? `Preview: ${pv ? `${n(pv.deals)} ${pv.deals === 1 ? "deal" : "deals"} worth ${money(pv.dollars * 100)} across your accounts` : "deals without an owner"} will count in Pipeline money. Nothing in your CRM changes, and you can turn it off again in Settings, Targets.`
            : "Preview: deals without an owner will be left out of Pipeline money again. Nothing in your CRM changes."}</p>
          <p className="mt-1">
            <button type="button" className="s6-btn" disabled={state === "saving"} onClick={() => void save()} data-testid={`${testId}-confirm`}>{state === "saving" ? "Saving..." : turnOn ? "Count them" : "Leave them out"}</button>{" "}
            <button type="button" className="ap-link" disabled={state === "saving"} onClick={() => { setAsk(false); setState("idle"); }}>Cancel</button>
          </p>
          {state === "error" && <p role="alert" data-testid={`${testId}-error`}>Could not save. Try again.</p>}
        </div>
      )}
      {state === "saved" && <p className="ap-fine" data-testid={`${testId}-saved`}>Saved. Refreshing the numbers...</p>}
    </div>
  );
}
