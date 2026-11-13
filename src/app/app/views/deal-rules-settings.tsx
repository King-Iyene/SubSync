"use client";

import { useState } from "react";
import { useApiClient, useData } from "../session";
import { Btn, Card } from "../ui";

// Settings, Targets, deal rules: should deals whose name looks like a test (a whole word: test, demo, dummy, sample, lorem) count in the money? Off by default, so a real account stays protected.
// One switch for the whole company. The owner or an administrator changes it; everyone else reads it. A change shows a preview of what will happen before it is saved.
type Got = { countTestDeals: boolean; canChange: boolean };

export function DealRulesSettings() {
  const api = useApiClient();
  const got = useData<Got>("deal-rules/test-names");
  const [edit, setEdit] = useState<boolean | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const title = "Deal rules";
  if (got.error) return <Card title={title}><p className="text-sm text-muted-foreground" role="alert">Could not load this setting. <button type="button" className="underline" onClick={got.reload}>Try again</button></p></Card>;
  if (!got.data) return <Card title={title}><p className="text-sm text-muted-foreground" role="status">Loading...</p></Card>;
  const d = got.data, on = edit ?? d.countTestDeals, locked = !d.canChange, dirty = on !== d.countTestDeals;
  const save = async () => {
    setState("saving");
    try { await api.put("deal-rules/test-names", { countTestDeals: on }); got.reload(); setEdit(null); setState("saved"); } catch { setState("error"); }
  };
  return (
    <Card title={title}>
      <div data-testid="deal-rules-settings">
        <label className="mb-2 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 size-4" disabled={locked} checked={on} onChange={(e) => { setEdit(e.target.checked); setState("idle"); }} data-testid="deal-rules-count-tests" />
          <span><span className="block font-medium">Count deals that look like tests</span><span className="block text-muted-foreground">Off (recommended for a live account): a deal with the word test, demo, dummy, sample or lorem in its name is left out of every money figure. On: those deals count like any other deal. Nothing is deleted either way.</span></span>
        </label>
        {dirty && <p className="mb-2 text-sm" data-testid="deal-rules-preview" role="status">{on ? "After you save, deals with test names will be counted in the money everywhere. Pipeline money will include them." : "After you save, deals with test names will be left out of the money again."}</p>}
        {locked ? <p className="text-xs text-muted-foreground" data-testid="deal-rules-readonly">Only the company owner or an administrator can change this.</p> : (
          <div className="flex items-center gap-3">
            <Btn variant="primary" onClick={() => void save()} disabled={state === "saving" || !dirty} testId="deal-rules-save">{state === "saving" ? "Saving..." : "Save"}</Btn>
            {state === "saved" && <span className="text-sm text-muted-foreground" role="status">Saved. The figures update on the next load.</span>}
            {state === "error" && <span className="text-sm text-destructive" role="alert">Could not save. Try again.</span>}
          </div>
        )}
      </div>
    </Card>
  );
}
