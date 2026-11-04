// The shape of one person in a People list, shared by the server (src/lib/analytics/people-*.ts) and the screens. Plain data: no database, no React.

export type PersonRowOut = {
  /** Unique inside one list. A person is `${locationId}:${contactId}`, except in the stale deals list, where each deal is a row of its own. */
  rowId: string;
  contactId: string; locationId: string; locationName: string | null; name: string; email: string | null; phone: string | null; tags: string[];
  source: string | null; owner: string | null; ownerName: string; dnd: boolean; timeZone: string | null; dateAdded: string | null; lastActivityAt: string | null;
  /** Calls logged from SubSync (the CRM's own call history is read one person at a time in the panel). */
  lastCallAt: string | null; calls: number; lastResult: string | null;
  url: string;
  /** One plain line about why this person is on the list ("Never answered, waiting 3 h"). Empty in a plain search. */
  why: string;
  /** When the reason began (ISO), when known. */
  at: string | null;
  /** Counted open deal dollars behind the reason, when the list is about money. */
  value: number | null;
  /** The person assigned to the thing behind the row, when it is not the contact's owner (a booking's assigned user). Used only for "Mine". */
  assignee?: string | null;
};
