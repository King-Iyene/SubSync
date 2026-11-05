import { Check, CircleAlert, Clock, Flag, Moon, TriangleAlert, type LucideIcon } from "lucide-react";

// ONE chip for every status word on Today (the rows, Do this first, the alerts and the records panels). Colour is never the only signal: each has a word and an icon. The text stays
// in the ink colour so it passes contrast in light and dark; the colour sits in the tint, the border and the icon. Tones come from Today's tokens (--t-bad, --t-warn, --t-ok, --t-accent).

type Tone = { Icon: LucideIcon; colour: string };
const TONES: Record<string, Tone> = {
  urgent: { Icon: CircleAlert, colour: "var(--t-bad, #b42318)" },
  soon: { Icon: TriangleAlert, colour: "var(--t-warn, #8a5a00)" },
  "can wait": { Icon: Clock, colour: "var(--t-ink3, #5b6678)" },
  raised: { Icon: Flag, colour: "var(--t-warn, #8a5a00)" },
  cleared: { Icon: Check, colour: "var(--t-ok, #2b7a3d)" },
  fixed: { Icon: Check, colour: "var(--t-ok, #2b7a3d)" },
  done: { Icon: Check, colour: "var(--t-ok, #2b7a3d)" },
  snoozed: { Icon: Moon, colour: "var(--t-accent, #1f4e8c)" },
};
export const statusTone = (word: string): Tone | null => TONES[word.trim().toLowerCase()] ?? null;
export const isStatusWord = (word: string) => statusTone(word) !== null;

export function StatusChip({ word }: { word: string }) {
  const tone = statusTone(word);
  if (!tone) return <span className="inline-block max-w-full truncate rounded-md border bg-muted/60 px-1.5 py-0.5 text-xs font-medium">{word}</span>;
  const { Icon, colour } = tone;
  return (
    <span data-testid="status-chip" data-status={word.trim().toLowerCase()} className="inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium text-[var(--t-ink,inherit)]"
      style={{ borderColor: `color-mix(in srgb, ${colour} 55%, transparent)`, background: `color-mix(in srgb, ${colour} 13%, transparent)` }}>
      <Icon aria-hidden className="size-3 shrink-0" style={{ color: colour }} /><span className="truncate">{word}</span>
    </span>
  );
}
