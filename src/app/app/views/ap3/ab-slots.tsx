"use client";

import { useState } from "react";
import { useData } from "../../session";
import { AppointmentMeetings } from "../appointment-meetings-ui";
import { AppointmentPanel } from "../appointment-panel";
import { BulkBar, RowQuickActions, useApptCaps } from "../appointment-actions-ui";
import { registerApSlot } from "./data";

// Mounts slice AB's checked change tools into the Appointments module's slots. Each piece shows only when its server flag is on (the caps call is refused when appt_actions is off,
// so nothing renders and the old read-only panel remains). Every change goes through the one gateway: preview first, typed words to delete, our own writes excluded from our numbers.

/** The panel body: timeline, who booked and who owns it, deal, reminders, edit, move, reassign, add, book again, delete. AB's own header is hidden; the module panel has one. */
function Details({ row, onChanged }: { row?: { id: string; locationId: string }; onChanged?: () => void }) {
  const caps = useApptCaps();
  if (!row || !caps) return null;
  return (
    <div className="-mx-4 [&>aside]:max-w-none [&>aside]:border-0 [&>aside]:bg-transparent [&>aside]:shadow-none [&>aside>div:first-child]:hidden" data-testid="ap-details-slot">
      <AppointmentPanel locationId={row.locationId} id={row.id} onClose={() => undefined} onChanged={onChanged} />
    </div>
  );
}

/** Two quick buttons (Showed, No-show) for a row, each with the preview. The panel already has the full set, so the panel does not render this slot. */
function RowActions({ row, onChanged }: { row?: { id: string; locationId: string; contactName: string }; onChanged?: () => void }) {
  const caps = useApptCaps();
  if (!row || !caps?.edit) return null;
  return <RowQuickActions locationId={row.locationId} appointmentId={row.id} contactName={row.contactName} onChanged={() => onChanged?.()} />;
}

type TeamPanel = { team: Array<{ id: string; name: string }> };
function BulkActions({ rows, onChanged }: { rows?: Array<{ id: string; locationId: string }>; onChanged?: () => void }) {
  const caps = useApptCaps();
  const [gone, setGone] = useState(false);
  const first = rows?.[0];
  const one = !!rows && rows.length > 0 && rows.every((r) => r.locationId === first!.locationId);
  const team = useData<TeamPanel>(caps?.bulk && one && first ? `appointments/act/panel?locationId=${encodeURIComponent(first.locationId)}&id=${encodeURIComponent(first.id)}` : null);
  if (!rows || !rows.length || !caps?.bulk || gone) return null;
  if (!one) return <span className="ap-fine" data-testid="ap-bulk-oneaccount">Pick appointments from one client account at a time to change several.</span>;
  return <BulkBar locationId={first!.locationId} ids={rows.map((r) => r.id)} team={team.data?.team ?? []} caps={caps} onChanged={() => onChanged?.()} onClear={() => setGone(true)} />;
}

function Meetings() {
  const caps = useApptCaps();
  if (caps?.meetings) return <AppointmentMeetings />;
  return <p className="ap-fine p-4" data-testid="ap-meetings-off">{caps ? "Meetings are not switched on for your account yet." : "Meetings need the appointment tools switched on first."}</p>;
}

let done = false;
/** Called once when the module loads (safe to call again). */
export function registerAbSlots() {
  if (done) return;
  done = true;
  registerApSlot("Details", Details);
  registerApSlot("RowActions", RowActions);
  registerApSlot("BulkActions", BulkActions);
  registerApSlot("Meetings", Meetings);
}
