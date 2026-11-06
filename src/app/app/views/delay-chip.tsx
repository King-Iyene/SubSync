"use client";

import { Ban, CopyCheck, Moon, PhoneOff, UserX, Users } from "lucide-react";
import { REASONS, type ReasonKey } from "@/lib/analytics/speed6";
import "./speed6.css";

const ICON: Record<ReasonKey, typeof Ban> = { no_owner: UserX, owner_busy: Users, after_hours: Moon, duplicate: CopyCheck, no_phone: PhoneOff, dnd: Ban };

/** Why a lead is waiting, in one word with an icon and a colour (the colour is never the only signal). The longer reason is in the hover tip. */
export function DelayChip({ reason }: { reason: ReasonKey }) {
  const r = REASONS[reason]; const I = ICON[reason];
  return <span className="s6-chip" data-tone={r.tone} data-testid="delay-reason" data-reason={reason} data-tip={r.tip} title={r.tip}><I aria-hidden className="size-3" />{r.label}</span>;
}
