# Decisions log

Format: date, decision, reason.

## 2026-10-28

- **Repo is `King-Iyene/SubSync`, made private.** It already existed (empty, public) when the build started; the brief calls for private, and CLAUDE.md is in it. Local folder is `C:\Users\KING\Desktop\SubSync`.
- **Commit and push straight to `main`.** King's standing instruction so Vercel auto-deploys on every push. No feature branches or PRs.
- **Next.js 16.4 (App Router, `src/`), React 19, Tailwind 4, shadcn/ui.** Latest `create-next-app` defaults. Its `AGENTS.md` says this Next.js has breaking changes, so read `node_modules/next/dist/docs/` before relying on older APIs.
- **GitHub CLI authenticated via device flow in King's logged-in browser tab.**
- **Supabase project `subsync` (ref `ugfvzcbkqnhtejgcqhsb`, East US / N. Virginia) on the FREE org "Vercel integration Base" for now.** King wanted to avoid the extra ~$10/mo a new project costs in the Pro org while building. Move to Pro before charging customers (Settings > Transfer project, or recreate and re-run migrations). Free projects pause after ~1 week idle and cap at 500 MB.
- **Project created with "Automatically expose new tables" OFF and "Enable automatic RLS" ON.** All access is server-side with the secret/service key; no RLS policies exist on purpose.
- **Migrations are applied with `supabase db push --db-url` using the DB password in `.env.local`**, so no `supabase login` is needed. The direct host `db.<ref>.supabase.co:5432` worked.
- **Schema (`20261028000000_init_schema.sql`):** installations, locations, cached_contacts, cached_opportunities, sync_jobs, settings. Contacts carry generated `full_name` and `phone_digits` columns with trigram indexes for search. Location tokens are minted on demand, not stored.
- **Secret key not yet in `.env.local`.** The browser tool was blocked from reading it, so King pastes it in or we add it to Vercel by hand.
- **Framing policy:** `/app` sends `Content-Security-Policy: frame-ancestors https:` so it can be embedded from any https origin (agencies use white-label domains, so a GHL-only allowlist would break real customers). Tradeoff: any https site could frame it, so identity and data access must rely on GHL SSO verification, never on the framing origin. Every other route is `frame-ancestors 'self'`.
- **Privacy and Terms pages are honest placeholders** (written 2026-10-28) and need human/legal review before going Public, because the app stores client contact data.
