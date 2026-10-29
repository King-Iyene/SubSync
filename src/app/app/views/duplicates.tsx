"use client";

import { useApiClient, useData } from "../session";
import { Badge, Btn, Empty, ErrorBox, ExtLink, Loading, PageHeader } from "../ui";

type Group = {
  locationId: string; locationName: string | null; kind: "email" | "phone"; key: string; count: number;
  contacts: Array<{ id: string; name: string; url: string }>;
};

export function DuplicatesView() {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<{ groups: Group[] }>("duplicates");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div>
      <PageHeader
        title="Duplicate contacts"
        subtitle="Contacts inside the same client account that share an email or phone number. We only compare within one account, never across clients, because different clients' customers must stay separate."
        actions={<Btn onClick={() => api.download("export/duplicates", "subsync-duplicates.csv")}>Export CSV</Btn>}
      />
      {data.groups.length === 0 ? (
        <Empty title="No duplicates found" body="No two contacts in the same account share an email or phone number." />
      ) : (
        <ul className="space-y-3">
          {data.groups.map((g) => (
            <li key={`${g.locationId}:${g.kind}:${g.key}`} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{g.locationName ?? "Unnamed account"}</span>
                <Badge tone="warn">{g.count} contacts share a {g.kind}</Badge>
                <span className="text-muted-foreground">{g.kind === "email" ? g.key : `ending ${g.key.slice(-4)}`}</span>
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                {g.contacts.map((c) => <li key={c.id}><ExtLink href={c.url}>{c.name}</ExtLink></li>)}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted-foreground">SubSync is read-only: merge duplicates in the platform using the links above.</p>
    </div>
  );
}
