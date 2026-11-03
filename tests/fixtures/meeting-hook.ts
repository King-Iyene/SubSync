import type { Attendee, Meeting } from "@/lib/analytics/meeting-intel";

// A meeting as a tool would send it, with the attendees the test chooses.
export function hookMeeting(title: string, attendees: Attendee[]): Meeting {
  return { source: "fathom", title, startedAt: "2026-10-30T10:00:00.000Z", attendees, summary: `Summary of ${title}`, actionItems: ["Follow up"], transcript: null, recordingUrl: "https://fathom.video/share/test" };
}
