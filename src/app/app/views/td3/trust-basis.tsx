"use client";

import { useState } from "react";
import { Info } from "lucide-react";

// The basis under every dollar figure (CLAUDE.md 13A): what was counted, what was left out and why, a "How this is worked out" panel (a button, not a bare link), and one tap to see the deals left out.
// The text comes from the one shared function (lib/analytics/deal-trust.ts), so this line reads the same on every screen.
export type TrustBasisData = { counting: string; leftOutLine: string | null; leftOutDeals: number; notJudged: number; howStale: string; howLeftOut: string };

export function TrustBasis({ t, onShowLeftOut }: { t: TrustBasisData; onShowLeftOut?: (() => void) | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="td-trust" data-testid="td-trust" style={{ margin: "6px 0 0", fontSize: 12, lineHeight: 1.5, color: "var(--muted-foreground, #7a8699)" }}>
      <p style={{ margin: 0 }} data-testid="td-trust-counting">
        {t.counting}{" "}
        <button type="button" className="ap-link" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="td-trust-how" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Info size={12} aria-hidden /> How this is worked out
        </button>
      </p>
      {t.leftOutLine && (
        <p style={{ margin: "2px 0 0" }} data-testid="td-trust-leftout">
          {t.leftOutLine}{" "}
          {onShowLeftOut && t.leftOutDeals > 0 && <button type="button" className="ap-link" onClick={onShowLeftOut} data-testid="td-trust-show">Show the deals left out</button>}
        </p>
      )}
      {t.notJudged > 0 && <p style={{ margin: "2px 0 0" }} data-testid="td-trust-notjudged">{t.notJudged.toLocaleString("en-US")} open {t.notJudged === 1 ? "deal is" : "deals are"} in steps with too little history to judge, so {t.notJudged === 1 ? "it is" : "they are"} not called quiet.</p>}
      {open && (
        <div role="note" data-testid="td-trust-panel" style={{ margin: "6px 0 0", padding: "8px 10px", border: "1px solid var(--border, #2a3342)", borderRadius: 8 }}>
          <p style={{ margin: 0 }}><b>Quiet deals.</b> {t.howStale}</p>
          <p style={{ margin: "6px 0 0" }}><b>Left out.</b> {t.howLeftOut}</p>
        </div>
      )}
    </div>
  );
}
