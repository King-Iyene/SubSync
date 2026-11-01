// What SubSync can really read from the platform, one declared list (stage F1, docs/CAPABILITIES.md, N64). Pure: no network, no database, so the
// rules that say WHY something is unavailable are unit tested. The probing that uses this list is in capabilities-run.ts.
//
// Three different causes used to be shown with the same words ("the platform does not give this app ..."), which sent people looking for a
// switch that did not exist. They are different, and the screen must say which one it is:
//   needs permission      the app never asked for the permission, or this install declined it; reconnecting (after a new release) can fix it
//   platform restricted   the permission is granted and the platform still refuses (a closed beta, a plan feature)
//   not exposed           the platform has no such data or no such address, so no permission can help

export type Cause = "available" | "partly" | "needs_permission_not_requested" | "needs_permission_declined" | "platform_restricted" | "not_exposed" | "not_verified";

export type Probe = {
  key: string; label: string; scope: string | null; version: string;
  /** The address to read, or null when it needs something an earlier probe finds (a calendar, a conversation). */
  path: (locationId: string, found: { calendarId: string | null; conversationId: string | null }) => string | null;
  /** Where the list sits in the answer, and where a total (if the platform sends one) sits. */
  list?: string[]; total?: string[];
  /** Fields a feature wants from one record. Reported as present or missing, never with their values. */
  fields?: string[];
  note?: string;
};

const DAY = 86_400_000;
export const CAPABILITY_PROBES: Probe[] = [
  { key: "contacts", label: "Contacts", scope: "contacts.readonly", version: "2021-07-28", path: (l) => `/contacts/?locationId=${l}&limit=1`, list: ["contacts"], total: ["meta", "total"],
    fields: ["id", "dateAdded", "dateUpdated", "lastActivity", "tags", "source", "dnd", "assignedTo", "dateOfBirth", "customFields", "email", "phone", "type"] },
  { key: "opportunities", label: "Deals", scope: "opportunities.readonly", version: "2021-07-28", path: (l) => `/opportunities/search?location_id=${l}&status=all&limit=1`, list: ["opportunities"], total: ["meta", "total"],
    fields: ["id", "monetaryValue", "assignedTo", "status", "pipelineId", "pipelineStageId", "lastStageChangeAt", "lastStatusChangeAt", "lastActionDate", "source", "createdAt", "updatedAt", "contact", "lostReasonId", "attributions"] },
  { key: "pipelines", label: "Pipelines and stages", scope: "opportunities.readonly", version: "2021-07-28", path: (l) => `/opportunities/pipelines?locationId=${l}`, list: ["pipelines"], fields: ["id", "name", "stages", "showInFunnel", "showInPieChart"] },
  { key: "conversations", label: "Conversation list (last message, unread)", scope: "conversations.readonly", version: "2021-04-15", path: (l) => `/conversations/search?locationId=${l}&limit=1&sortBy=last_message_date&sort=desc&status=all`, list: ["conversations"], total: ["total"],
    fields: ["id", "contactId", "lastMessageType", "lastMessageDirection", "lastMessageDate", "unreadCount", "assignedTo", "lastOutboundMessageAction", "lastManualMessageDate", "scoring"] },
  { key: "messages", label: "Messages inside a conversation (who sent each, person or automation)", scope: "conversations/message.readonly", version: "2021-04-15",
    path: (l, c) => (c.conversationId ? `/conversations/${encodeURIComponent(c.conversationId)}/messages?locationId=${l}&limit=20` : null), list: ["messages", "messages"],
    fields: ["id", "direction", "messageType", "type", "userId", "source", "status", "dateAdded", "meta", "body"], note: "message text is in the platform's answer; SubSync never stores it" },
  { key: "calendars", label: "Calendars", scope: "calendars.readonly", version: "2021-04-15", path: (l) => `/calendars/?locationId=${l}`, list: ["calendars"], fields: ["id", "name", "teamMembers", "calendarType", "isActive"] },
  { key: "events", label: "Appointments (status, who it is assigned to)", scope: "calendars/events.readonly", version: "2021-04-15",
    path: (l, c) => (c.calendarId ? `/calendars/events?locationId=${l}&calendarId=${c.calendarId}&startTime=${Date.now() - 30 * DAY}&endTime=${Date.now() + 30 * DAY}` : null), list: ["events"],
    fields: ["id", "appointmentStatus", "assignedUserId", "contactId", "startTime", "endTime", "calendarId", "dateAdded", "address"] },
  { key: "calendarGroups", label: "Calendar groups", scope: "calendars/groups.readonly", version: "2021-04-15", path: (l) => `/calendars/groups?locationId=${l}`, list: ["groups"], fields: ["id", "name"] },
  { key: "calendarRooms", label: "Calendar rooms and equipment", scope: "calendars/resources.readonly", version: "2021-04-15", path: (l) => `/calendars/resources/rooms?locationId=${l}&limit=1&skip=0`, list: [], fields: [] },
  { key: "users", label: "Team members (names, roles)", scope: "users.readonly", version: "2021-07-28", path: (l) => `/users/?locationId=${l}`, list: ["users"], fields: ["id", "name", "firstName", "lastName", "email", "phone", "roles", "profilePhoto", "permissions"] },
  { key: "location", label: "Account details (time zone, settings)", scope: "locations.readonly", version: "2021-07-28", path: (l) => `/locations/${l}`, list: ["location"], fields: ["id", "name", "timezone", "email", "phone", "website", "settings", "business", "social"] },
  { key: "tags", label: "Tag names", scope: "locations/tags.readonly", version: "2021-07-28", path: (l) => `/locations/${l}/tags`, list: ["tags"], fields: ["id", "name"] },
  { key: "customFields", label: "Custom field definitions", scope: "locations/customFields.readonly", version: "2021-07-28", path: (l) => `/locations/${l}/customFields`, list: ["customFields"], fields: ["id", "name", "fieldKey", "dataType", "model"] },
  // The next four are permissions the app does not ask for. A refusal here is exactly what shows the cause is a missing permission.
  { key: "workflows", label: "Workflows (are automations running)", scope: "workflows.readonly", version: "2021-07-28", path: (l) => `/workflows/?locationId=${l}`, list: ["workflows"], fields: ["id", "name", "status"] },
  { key: "transactions", label: "Payments (failed payments, rebills)", scope: "payments/transactions.readonly", version: "2021-07-28", path: (l) => `/payments/transactions?altId=${l}&altType=location&limit=1`, list: ["data"], fields: ["_id", "status", "amount", "currency"] },
  { key: "invoices", label: "Invoices", scope: "invoices.readonly", version: "2021-07-28", path: (l) => `/invoices/?altId=${l}&altType=location&limit=1&offset=0`, list: ["invoices"], fields: ["_id", "status", "total"] },
  { key: "forms", label: "Forms (lead source detail)", scope: "forms.readonly", version: "2021-07-28", path: (l) => `/forms/?locationId=${l}&limit=1`, list: ["forms"], fields: ["id", "name"] },
];

export type ProbeFacts = { requestedByApp: boolean | null; grantedByInstall: boolean | null; status: number | null; fieldsMissing?: string[]; fieldsPresent?: string[] };

/** Why a data point is or is not available, from what the platform answered. */
export function classifyProbe(f: ProbeFacts): { cause: Cause; words: string } {
  const s = f.status;
  if (s === null) return { cause: "not_verified", words: "Not called." };
  if (s === 200) {
    const present = f.fieldsPresent ?? [];
    const missing = f.fieldsMissing ?? [];
    if (missing.length > 0 && present.length > 0) return { cause: "partly", words: `Available. The platform did not send: ${missing.join(", ")}.` };
    return { cause: "available", words: "Available." };
  }
  if (s === 401 || s === 403) {
    if (f.requestedByApp === false) return { cause: "needs_permission_not_requested", words: "Needs permission: SubSync never asked for it. It can be added as an optional permission in a new release." };
    if (f.grantedByInstall === false) return { cause: "needs_permission_declined", words: "Needs permission: reconnect and accept it." };
    return { cause: "platform_restricted", words: "Not available from the platform yet: it refused even with the permission granted." };
  }
  if (s === 404 || s === 405 || s === 410 || s === 422) return { cause: "not_exposed", words: "Not exposed: the platform has no such data at this address." };
  return { cause: "not_verified", words: `Not verified: the platform answered ${s}. Try again.` };
}

/** Pull a list out of an answer by path (an empty path means the answer itself). */
export function dig(o: unknown, path: string[]): unknown {
  return path.reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Record<string, unknown>)[k] : undefined), o);
}

/** Fields present in a sample of records, and how many records carry a real value for each (names and counts only, never values). */
export function fieldReport(items: Array<Record<string, unknown>>, fields: string[]) {
  const first = items[0];
  if (!first) return { fieldsPresent: [] as string[], fieldsMissing: fields, filled: {} as Record<string, number>, sample: 0 };
  const present = fields.filter((f) => items.some((it) => f in it));
  const filled = Object.fromEntries(present.map((f) => [f, items.filter((it) => it[f] !== null && it[f] !== undefined && it[f] !== "" && !(Array.isArray(it[f]) && (it[f] as unknown[]).length === 0)).length]));
  return { fieldsPresent: present, fieldsMissing: fields.filter((f) => !present.includes(f)), filled, sample: items.length };
}
