"use client";

import { useEffect, useState } from "react";
import { AI_WHAT, aiLine, aiStatus, type AiFacts } from "@/lib/connections/tools-status";
import { Btn } from "../ui";
import { AiPanel, type Status } from "./ai-card";
import { ToolRow } from "./connections-tools";

/** What the row needs from the AI status request, in the words of tools-status. */
export function aiFactsOf(data: Status | undefined, error: { status?: number } | null | undefined): AiFacts {
  return {
    notSwitchedOn: Boolean(error && error.status === 404), failed: Boolean(error && error.status !== 404),
    canManage: data?.canManage === true, killed: data?.killed === true,
    connection: data?.connection ? { provider: data.connection.provider, model: data.connection.model, status: data.connection.status, paused: data.connection.paused } : null,
  };
}

/** The AI tool in the "Your tools" list: status, one plain line, one primary button that opens the connect options right here. */
export function AiToolRow({ data, error, reload }: { data: Status | undefined; error: { status?: number } | null | undefined; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(() => typeof window !== "undefined" && window.location.hash === "#tool-ai");
  const facts = aiFactsOf(data, error);
  const s = aiStatus(facts);
  const connected = facts.connection !== null;

  // The sign-in window may finish while the options are folded away: still refresh the row.
  useEffect(() => {
    const on = (e: MessageEvent) => { if (e.origin === window.location.origin && e.data?.subsync === "connection" && e.data.provider === "ai") void reload(); };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [reload]);


  return (
    <ToolRow id="ai" icon="ai" name="AI" tone={s.tone} status={s.text} line={aiLine(facts)} what={AI_WHAT} owner="Your company account. Only an administrator connects it; the key is stored encrypted and never shown again.">
      {facts.canManage && !facts.notSwitchedOn && !facts.failed && (
        <div className="space-y-3">
          <Btn variant={connected ? "secondary" : "primary"} onClick={() => setOpen((v) => !v)} testId="ai-open">{open ? "Hide" : connected ? "Manage your AI" : "Connect your AI"}</Btn>
          {open && data && <div className="rounded-lg border p-3" data-testid="ai-inline"><AiPanel data={data} reload={reload} bare /></div>}
        </div>
      )}
    </ToolRow>
  );
}
