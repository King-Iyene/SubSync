"use client";

import type { Pp3NextLead, Pp3Person, Pp3Proof } from "@/lib/analytics/people3-types";

// Mount points for the actions builder (slice PB). Each one renders nothing until PB fills it in, so the screens never show a dead button.
// PB owns: coaching notes and targets, the "away" mark, snooze of an idle alert, moving leads (preview, confirm, undo), the "assign" step of the next-lead suggestion, and the proof receipt's copy, print and CSV.
// These components receive only what the screen already shows; the server decides what the caller may change.
type Changed = { onChanged: () => void };

/** In the person panel and on the Coaching tab: add a note, set a target, mark away, snooze the idle alert. */
export function PersonActionsSlot(props: { person: Pp3Person; locationId: string | null } & Changed) { void props; return null; }
/** In Workload, beside a heavy or waiting row: "Move leads" opens the preview. */
export function MoveLeadsSlot(props: { userId: string; locationId: string; waiting: number } & Changed) { void props; return null; }
/** Under the next-lead suggestion: "Assign" (preview first; never automatic). */
export function AssignSlot(props: { suggestion: Pp3NextLead } & Changed) { void props; return null; }
/** On the Proof tab: copy, print and CSV of the receipt. */
export function ProofActionsSlot(props: { proof: Pp3Proof }) { void props; return null; }
