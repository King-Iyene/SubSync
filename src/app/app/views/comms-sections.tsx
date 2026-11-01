"use client";

import { useData } from "../session";
import { Card, fmtInt, fmtMoney } from "../ui";

type Data = { afterHours: { leads: number; afterHoursPct: number | null; weekendPct: number | null; wonValue: number; wonCount: number; suggestion: string | null } };

// When new contacts arrive, under the Unanswered messages page. The wait chart that used to sit here is now part of the page (it is drawn from the same rows as
// the list), and the open deals with no contact moved to Pipeline (QuietDeals). `gaps=0` tells the server not to count those deals for this page.
export function AfterHoursCard() {
  const { data } = useData<Data>("comms-intel?gaps=0");
  if (!data) return null;
  const a = data.afterHours;
  return (
    <div className="mt-6">
      <Card title="Leads that arrive after hours">
        {a.leads === 0 ? <p className="text-sm text-muted-foreground">No new contacts in the last 90 days.</p> : (
          <>
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div><dt className="text-muted-foreground">Outside 9 to 5</dt><dd className="text-lg font-semibold tabular-nums">{a.afterHoursPct}%</dd></div>
              <div><dt className="text-muted-foreground">On weekends</dt><dd className="text-lg font-semibold tabular-nums">{a.weekendPct}%</dd></div>
              <div><dt className="text-muted-foreground">Won from them</dt><dd className="text-lg font-semibold tabular-nums">{fmtMoney(a.wonValue)}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">Based on {fmtInt(a.leads)} new contacts in 90 days, in each account&apos;s own time zone.</p>
            {a.suggestion && <p className="mt-2 text-sm">{a.suggestion}</p>}
          </>
        )}
      </Card>
    </div>
  );
}
