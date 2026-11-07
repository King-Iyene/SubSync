import { initialsOf } from "@/lib/design/wait";

/** The shared look of a slim lead row in Speed: a small initials chip before the name and a muted "Lead" tag after it. */
export function LeadMark({ name }: { name: string }) {
  return <span aria-hidden className="mr-2 inline-grid size-6 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] align-middle text-[10px] font-semibold text-foreground" data-testid="lead-initials">{initialsOf(name)}</span>;
}
export const LeadTag = () => <span className="ml-2 shrink-0 text-xs font-normal text-muted-foreground">Lead</span>;

/** A whole row opens the lead, unless the click landed on a button, link or field inside it (those do their own thing). */
export function openOnRowClick(open: () => void) {
  return (e: React.MouseEvent<HTMLElement>) => { if ((e.target as HTMLElement).closest("button,a,select,input,textarea,[role=menu],[role=menuitem]")) return; open(); };
}
export const ROW_CLICK = "cursor-pointer transition-colors hover:bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]";
