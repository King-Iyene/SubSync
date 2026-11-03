// One true statement about what SubSync does with a meeting summary, used by every screen that says it (N77): Settings, Connections, the Meeting notes
// page, Getting started and the help answer. Before this file, Settings and Connections said SubSync adds the summary to the contact's notes in the CRM
// while the Meeting notes page said it does not write into the CRM at all. Both could not be true.
//
// What the code really does (src/lib/analytics/meeting-crm.ts): a summary is saved in SubSync; when the guest's email matches exactly one contact, it is
// also written once as a note on that contact (POST /contacts/{id}/notes), and only when the setting is on and the install granted the permission to add
// notes. A refusal by the platform is stored as "needs permission" and the meeting stays saved in SubSync.

/** The permission the note needs. Kept here so a screen and the scope list name the same one. */
export const NOTE_SCOPE = "contacts.write";

/** What it says when the permission is missing. The same words as every other "Needs permission" prompt (N64). */
export const NEEDS_PERMISSION = "Needs permission: reconnect";

export const CRM_NOTE_RULE =
  "SubSync saves each meeting summary inside SubSync. When the guest's email matches exactly one contact, it also adds the summary as a note on that contact in your CRM, once per meeting. It sends nothing to the people in the meeting.";

/** The answer to "does SubSync change anything in my CRM?", used by the help page and the install confirmation page. */
export const CRM_WRITE_SUMMARY =
  "SubSync mostly reads your data. The one thing it adds on its own is a note on a contact when a meeting summary arrives from a tool you connect and the guest's email matches exactly one contact. It needs the permission to add notes, and you can switch it off in Settings.";

export type NoteState = { text: string; canEnable: boolean; tone: "ok" | "needs_permission" | "off" };

/** `granted`: whether the install approved the add-notes permission (null: not known, for example the demo). `enabled`: the Settings choice. */
export function crmNoteState(granted: boolean | null, enabled: boolean): NoteState {
  if (granted === false) return { text: `${NEEDS_PERMISSION}. SubSync cannot add notes to your contacts until you accept the permission to add notes. Meetings are still saved inside SubSync.`, canEnable: false, tone: "needs_permission" };
  if (!enabled) return { text: "Switched off: meetings are saved inside SubSync only.", canEnable: true, tone: "off" };
  return { text: "On: a matched contact gets the note in your CRM.", canEnable: true, tone: "ok" };
}

/** The sentence under the Meeting notes page and the Connections card. */
export const crmNoteFootnote = (granted: boolean | null, enabled: boolean): string => `${CRM_NOTE_RULE} ${crmNoteState(granted, enabled).text}`;
