"use client";

import { Section } from "../ds";
import { useData } from "../session";
import { Btn, Empty, ErrorBox, ExtLink, fmtInt, Loading, timeAgo } from "../ui";

// Clean-up, "Invalid and old leads" tab (stage C2). A read-only list. SubSync never deletes a contact: it shows who cannot be reached or
// has been quiet for a year, and the Tags tab can tag them for review. Do not disturb contacts, open deals and appointments are never listed.

type Row = { contactId: string; locationId: string; locationName: string | null; name: string; email: string | null; phone: string | null; reason: "nothing" | "bad_email" | "old"; lastActivityAt: string | null; url: string };
type Data = { counts: { nothing: number; bad_email: number; old: number }; sample: Row[] };

const WORDS = { nothing: "No email and no phone", bad_email: "The email address looks wrong", old: "No activity for a year" } as const;

export function CleanupLeads({ onTag }: { onTag: () => void }) {
  const { data, error, loading, reload } = useData<Data>("cleanup/leads");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const total = data.counts.nothing + data.counts.bad_email + data.counts.old;
  return (
    <div>
      <Section title={`${fmtInt(total)} contact${total === 1 ? "" : "s"} to look at`} hint="SubSync never deletes contacts. Tag them, then decide in your CRM."
        action={total > 0 ? <Btn onClick={onTag}>Tag them for review</Btn> : undefined}>
        {total === 0 ? <Empty title="Nothing to tidy" body="Every contact can be reached and has been active in the last year." /> : (
          <ul className="space-y-1 text-sm" data-testid="leads-counts">
            {(["nothing", "bad_email", "old"] as const).map((k) => <li key={k}>{WORDS[k]}: <strong>{fmtInt(data.counts[k])}</strong></li>)}
          </ul>
        )}
      </Section>
      {data.sample.length > 0 && (
        <Section title="A few examples" hint="Contacts with do not disturb, an open deal or an appointment are left out.">
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {data.sample.map((r) => (
              <li key={r.locationId + r.contactId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span className="min-w-0"><span className="font-medium">{r.name}</span><span className="block truncate text-xs text-muted-foreground">{WORDS[r.reason]} · {r.locationName ?? "Unnamed account"}{r.lastActivityAt ? ` · last active ${timeAgo(r.lastActivityAt)}` : ""}</span></span>
                <ExtLink href={r.url}>Open in your CRM</ExtLink>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
