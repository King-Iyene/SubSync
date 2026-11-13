// Who we are, written once, so the Trust page, the privacy page, the terms, the support page and the footer can never say different things (N75: "company
// details that match everywhere"). A test (src/lib/__tests__/trust-truth.test.ts) reads every public page and fails when one of them names the
// company or the support address differently from this file.
//
// Only what is really known is here. A registration number, a registered address, a phone number and named founders are NOT invented: they are
// listed as open items in docs/features/F8.md and docs/NEEDS_KING.md, and they are added here (and nowhere else) when King supplies them.
export const COMPANY = {
  legalName: "KD Squares Ltd",
  product: "SubSync",
  supportEmail: "code@kdsquares.com",
  /** What the support page and the help page both promise. A commitment, not something software can check. */
  supportReply: "one business day",
} as const;

/** The outside services that process data, and why. The Trust page lists exactly these; a test checks each one against the code or the config. */
export type Processor = { id: "hosting" | "database" | "email" | "slack" | "fathom" | "crm" | "ai"; name: string; role: string; whenUsed: string };
export const PROCESSORS: readonly Processor[] = [
  { id: "hosting", name: "Vercel", role: "Runs the SubSync app and its scheduled jobs.", whenUsed: "Always." },
  { id: "database", name: "Supabase", role: "Holds the database (everything listed under what we store).", whenUsed: "Always." },
  { id: "email", name: "Resend", role: "Sends the emails SubSync sends (alerts, the Monday summary, the test emails).", whenUsed: "Only when an email address is set and email sending is switched on." },
  { id: "crm", name: "Your CRM", role: "The source of the data. SubSync reads from it with the permissions you approved, and adds notes to a contact only with the add-notes permission.", whenUsed: "Always." },
  { id: "slack", name: "Slack", role: "Receives the alerts and the daily brief, in the channel you choose.", whenUsed: "Only if you connect it." },
  { id: "fathom", name: "Fathom", role: "Sends meeting summaries to SubSync.", whenUsed: "Only if you connect it." },
  { id: "ai", name: "Your own AI provider", role: "Receives the short summary of counts that SubSync sends to write the 7 am brief wording, under your own account and terms.", whenUsed: "Only if an administrator connects their own AI account (OpenRouter, Anthropic, OpenAI, Google or a compatible service)." },
];
