// The Trust page, as data (N75). Every sentence on it is one of three kinds, and a test (src/lib/__tests__/trust-truth.test.ts) refuses anything else:
//   derived     produced from code that is itself tested against the database or the scope list (what we store, what is deleted, which permissions and why,
//               the outside services). It cannot say more or less than the code does.
//   claim       a statement about how the app behaves. The test keeps one or more PROOFS for each claim id (a pattern that must be in a file, a word that must
//               be absent from the source, a count from the migrations) and runs them. If the code changes so a proof fails, the build fails until the
//               sentence is corrected or removed. The proofs live in the test, not here, so this file holds only words.
//   commitment  a promise that software cannot check (a reply time, how we would tell you about an incident). These are shown under their own heading so
//               nobody mistakes them for something the code guarantees.
// A feature that is switched off (Zoom, Google Meet) is not mentioned at all. Pure: no database, no React.
import { COMPANY, PROCESSORS } from "./company.ts";
import { deleteMyDataText, SHARE_LINK_DAYS, storeLines, uninstallText } from "./data-inventory.ts";
import { GHL_SCOPES } from "./ghl/scopes.ts";
import { NO_PERMISSION_GROUPS, NOT_REQUESTED, SCOPE_GROUPS } from "./scope-groups.ts";

export const TRUST_UPDATED = "13 November 2026";

export type Claim = { id: string; text: string };

export const CLAIMS: readonly Claim[] = [
  { id: "tokens_encrypted", text: "The access keys SubSync holds for your CRM are encrypted before they are stored (AES-256-GCM)." },
  { id: "keys_hashed", text: "API keys and private meeting addresses are stored only as a one-way hash, so we cannot read them back." },
  { id: "rls", text: "Every table in the database has row-level security switched on, and only the server (never your browser) can reach the database." },
  { id: "no_passwords", text: "SubSync stores no passwords. You sign in through your CRM, which tells SubSync who you are, and the answer is checked with a secret only SubSync and your CRM share." },
  { id: "signed_sessions", text: "A sign-in lasts one hour and is signed, so it cannot be changed or forged." },
  { id: "webhook_signed", text: "Notifications from your CRM are accepted only when their digital signature checks out." },
  { id: "client_read_only", text: "A client's own staff see a read-only view of their own account only. Never another client, your fees, your notes or your settings." },
  { id: "isolation_tests", text: "Automatic tests try to read one company's data while signed in as another, and must be refused." },
  { id: "owner_delete", text: "Only the owner of the company account can press Delete my data, they must type the word DELETE, and every attempt, allowed or refused, is written to a record that is kept." },
  { id: "settings_audit", text: "Every change to a setting is recorded, with who changed it and when. You can read the history under Settings, Advanced." },
  { id: "ai_own", text: "No artificial-intelligence service receives your data unless an administrator connects their own AI account. SubSync does not choose or pay for one. By default only counts, dollar estimates and the labels you set up yourself (tags, lead sources, pipeline step names) are sent, never names, email addresses, phone numbers or messages, unless that account switches names on, and you can see exactly what was sent." },
  { id: "send_on_press", text: "SubSync sends a text or an email only when a person presses Send after a preview (or a schedule they set), never on its own. It never sends to a contact who asked not to be contacted: it asks your CRM again just before each send and stops if it cannot tell. The permission to send is optional, and each send is recorded with who sent it, when and to whom (never the words)." },
  { id: "changes_crm", text: "SubSync can change things in your CRM: book and update appointments, add and remove tags, update deals, write notes and tasks, change who owns a contact, fix contact data, merge duplicates and set up workflows. Each change needs its own optional permission, shows a preview, needs a confirm and is written to an audit log. The full list is in docs/CRM_WRITES.md." },
  { id: "never_stored", text: "The text of your customers' messages is never copied into SubSync." },
  { id: "kill_switch", text: "We can put SubSync into maintenance mode at once, which stops every sync, job and email." },
  { id: "webhook_ids_3_days", text: "The list of notifications already handled is cleared after 3 days." },
  { id: "email_unsubscribe", text: "Every email SubSync sends carries a link to stop it." },
];

export const COMMITMENTS: readonly { id: string; text: string }[] = [
  { id: "support", text: `You can email ${COMPANY.supportEmail} and we reply within ${COMPANY.supportReply}.` },
  { id: "no_sale", text: "We do not sell your data and do not use it for advertising." },
  { id: "incident", text: "If we learn that data held by SubSync was exposed, we tell the owner of every affected company account by email as soon as we know what happened, say what was involved and what we did about it, and do not wait for a regulator to ask." },
  { id: "compliance", text: "We are working toward the data-protection rules that apply to our customers, including the GDPR and Nigeria's data protection law. We do not claim to be certified under either." },
];

export type Item = { title?: string; text: string; kind: "derived" | "claim" | "commitment"; claim?: string; commitment?: string };
export type TrustSection = { id: string; title: string; intro?: string; items: Item[] };

const claim = (id: string): Item => ({ text: CLAIMS.find((c) => c.id === id)!.text, kind: "claim", claim: id });
const promise = (id: string): Item => ({ text: COMMITMENTS.find((c) => c.id === id)!.text, kind: "commitment", commitment: id });

const requiredCount = SCOPE_GROUPS.flatMap((g) => g.scopes).filter((s) => s.required).length;

/** What the page says, in order. Section ids are the page's anchors. */
export function trustSections(): TrustSection[] {
  const store = storeLines({ meetings: true });
  return [
    { id: "read", title: "What SubSync reads and changes", intro: `SubSync asks your CRM for ${GHL_SCOPES.length} permissions: ${requiredCount} required and ${GHL_SCOPES.length - requiredCount} optional. Fewer is safer, so each has a reason, and an optional one can be declined: the feature that needs it then says "Needs permission: reconnect" and everything else keeps working.`,
      items: [
        ...SCOPE_GROUPS.map((g): Item => ({ title: g.title, text: `${g.summary} ${g.scopes.map((s) => `${s.scope} (${s.required ? "required" : "optional"}, ${s.kind}): ${s.why}`).join(" ")}`, kind: "derived" })),
        ...NO_PERMISSION_GROUPS.map((g): Item => ({ title: g.title, text: g.text, kind: "derived" })),
        { title: "Not requested", text: NOT_REQUESTED.map((n) => `${n.scope}: ${n.why}`).join(" "), kind: "derived" },
        claim("changes_crm"),
        claim("send_on_press"),
      ] },
    { id: "store", title: "What SubSync stores", intro: "This list is produced from the database itself, table by table, and an automatic test fails when the database holds something that is not on it.",
      items: [...store.map((l): Item => ({ title: l.title, text: l.text, kind: "derived" })), claim("never_stored")] },
    { id: "how-long", title: "For how long",
      intro: `Everything is kept until you delete it or uninstall. The exceptions: a share link stops working after ${SHARE_LINK_DAYS} days, and the list of notification ids already handled is cleared after 3 days.`,
      items: [claim("webhook_ids_3_days")] },
    { id: "delete", title: "How to delete it", items: [
      { title: "Delete my data", text: deleteMyDataText(), kind: "derived" },
      { title: "Uninstall", text: uninstallText(), kind: "derived" },
      claim("owner_delete"),
    ] },
    { id: "services", title: "Which outside services handle data", intro: "These are the only ones.",
      items: [...PROCESSORS.map((p): Item => ({ title: p.name, text: `${p.role} ${p.whenUsed}`, kind: "derived" })), claim("ai_own")] },
    { id: "security", title: "Security practices", items: [claim("tokens_encrypted"), claim("keys_hashed"), claim("rls"), claim("no_passwords"), claim("signed_sessions"), claim("webhook_signed"), claim("client_read_only"), claim("isolation_tests"), claim("settings_audit"), claim("email_unsubscribe")] },
    { id: "incidents", title: "If something goes wrong", intro: "What the software does, and what we promise.", items: [claim("kill_switch"), promise("incident")] },
    { id: "status", title: "Is SubSync working?", intro: "There is no public status page yet. Your own account's answer is in the app: Settings, Sync status shows when each account was last read, what runs and when, and anything that failed, in plain words.", items: [] },
    { id: "fathom", title: "Connecting Fathom", intro: "When you connect Fathom, Fathom shows a notice that SubSync has not been reviewed by Fathom yet. That is because Fathom's review program for apps is new, not because anything is wrong; we will apply when it opens. SubSync receives a meeting's title, who attended, the summary, the action items and a link to the recording. A transcript is kept only if you switch that on in Settings, because a summary can still hold private details such as health or money matters. You are responsible for telling people in a meeting that it is recorded and for having their consent. Each person connects their own Fathom and can disconnect it at any time.", items: [] },
    { id: "company", title: "Who we are", intro: `${COMPANY.product} is made and operated by ${COMPANY.legalName}. Support: ${COMPANY.supportEmail}.`, items: [promise("support"), promise("no_sale"), promise("compliance")] },
  ];
}

/** All the words on the page, for the tests that scan them. */
export function trustText(): string {
  return trustSections().flatMap((s) => [s.title, s.intro ?? "", ...s.items.flatMap((i) => [i.title ?? "", i.text])]).join("\n");
}

/** Section ids in order (the menu at the top of the page, and the anchors). */
export const trustMenu = () => trustSections().map((s) => ({ id: s.id, title: s.title }));
