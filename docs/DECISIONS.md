# Decisions log

Format: date, decision, reason.

## 2026-10-28

- **Repo is `King-Iyene/SubSync`, made private.** It already existed (empty, public) when the build started; the brief calls for private, and CLAUDE.md is in it. Local folder is `C:\Users\KING\Desktop\SubSync`.
- **Commit and push straight to `main`.** King's standing instruction so Vercel auto-deploys on every push. No feature branches or PRs.
- **Next.js 16.4 (App Router, `src/`), React 19, Tailwind 4, shadcn/ui.** Latest `create-next-app` defaults. Its `AGENTS.md` says this Next.js has breaking changes, so read `node_modules/next/dist/docs/` before relying on older APIs.
- **GitHub CLI authenticated via device flow in King's logged-in browser tab.**
