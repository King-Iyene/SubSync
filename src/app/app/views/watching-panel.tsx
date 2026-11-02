"use client";

import { CAUSE_LABEL, NOT_YET, WATCHING, type NotYet, type Watching } from "@/lib/analytics/coverage";

// "What SubSync watches" (note N5, stage F5): two columns, Watching and Not yet. It used to be the bottom of Today; it lives in Settings now, so the front door
// stays clean and the honesty stays. As an item ships it moves from the right column to the left (src/lib/analytics/coverage.ts). A plain section with a thin
// rule between the columns, no card, so it sits equally well in any Settings group. It reads no data: the lists are the product's own.
export function WatchingPanel({ watching = WATCHING, notYet = NOT_YET }: { watching?: Watching[]; notYet?: NotYet[] }) {
  return (
    <section aria-labelledby="watching-h" data-testid="watching-panel" className="mb-8">
      <h2 id="watching-h" className="text-base font-semibold">What SubSync watches</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">The problems SubSync looks for in your client accounts. What it cannot watch yet is on the right, so you never assume something is being watched when it is not.</p>
      <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
        <div data-testid="watching-column">
          <h3 className="border-b pb-1.5 text-sm font-semibold">Watching ({watching.length})</h3>
          <ul className="divide-y">
            {watching.map((w) => (
              <li key={w.id} className="py-2.5 text-sm">
                <p className="font-medium">{w.what}</p>
                <p className="text-xs leading-5 text-muted-foreground">{w.how}</p>
                {w.needs && <p className="text-xs leading-5 text-muted-foreground">Needs: {w.needs.charAt(0).toLowerCase() + w.needs.slice(1)}.</p>}
              </li>
            ))}
          </ul>
        </div>
        <div data-testid="not-yet-column">
          <h3 className="border-b pb-1.5 text-sm font-semibold">Not yet ({notYet.length})</h3>
          {notYet.length === 0 ? (
            <p className="py-2.5 text-sm text-muted-foreground">Everything on the list is being watched.</p>
          ) : (
            <ul className="divide-y">
              {notYet.map((n) => (
                <li key={n.id} className="py-2.5 text-sm">
                  <p className="font-medium">{n.what}</p>
                  <p className="text-xs leading-5 text-muted-foreground"><span className="font-medium text-foreground">{CAUSE_LABEL[n.cause]}.</span> {n.why.charAt(0).toUpperCase() + n.why.slice(1)}.</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
