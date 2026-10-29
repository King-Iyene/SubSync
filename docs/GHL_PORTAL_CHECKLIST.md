# GHL developer portal checklist (Step 4)

Production URL used below: `https://subsync-king-iyenes-projects.vercel.app`
Portal: https://marketplace.gohighlevel.com > My Apps > SubSync (draft, vdraft)

Before you start: Vercel Deployment Protection must be OFF for production, or the portal and reviewers will hit a Vercel login. Vercel > subsync > Settings > Deployment Protection > turn off Vercel Authentication for Production (leave Preview as is).

Label names below were checked against the GHL docs on 2026-10-28; the portal UI may word things slightly differently.

## 1. Basic info (Build > Profile)

| Field | Value |
|---|---|
| App name | SubSync |
| App logo | upload `public/brand/subsync-logo-512.png` (512x512, 18 kB) |
| Tagline | One dashboard for all your client accounts |
| Company | KD Squares Ltd |
| Website | https://subsync-king-iyenes-projects.vercel.app |
| Category | Data management, Analytics and data, CRM (already selected) |
| Business niche | closest to "agencies" / "marketing agencies" |

## 2. Listing copy (Profile / Getting Started)

Short description:

> SubSync gives teams that manage many client accounts one place to search contacts across every account, spot stale deals, check data quality, and track onboarding progress.

Long description:

> Managing dozens of client accounts means jumping between dashboards all day. SubSync connects to your accounts and brings the important signals into one view.
> - Search any contact across all client accounts at once
> - See data health per account: missing emails, missing phones, untagged and inactive contacts
> - Catch stale deals before they go cold, across every pipeline
> - Track onboarding progress for each new client account
> Built for agencies and teams that manage many client accounts. Install once, see everything.

Getting started: 1) Install SubSync and approve access. 2) Wait a few minutes for the first sync. 3) Open SubSync from your menu and start with Search.

Public text must say "client accounts", never "sub-accounts", and must not use the platform's name or logo.

## 3. Support details

| Field | Value |
|---|---|
| Support email | code@kdsquares.com |
| Support URL | https://subsync-king-iyenes-projects.vercel.app/support |
| Privacy policy URL | https://subsync-king-iyenes-projects.vercel.app/privacy |
| Terms URL | https://subsync-king-iyenes-projects.vercel.app/terms |

## 4. App settings

- App type: Private (switch to Public only at the end).
- Who can install: **Agencies Only**. The draft currently says "Agency And Sub-Account" under Installed By and "Sub-Account" under Target User. Change these so the app is agency-level (company-level OAuth). If Target User offers an Agency option, pick it.
- Listing type: Standard (the docs recommend White-label for marketing agencies; confirm with King).

## 5. Build > Advanced Settings > Auth

- Redirect URL (type each, click **Add**):
  - `http://localhost:3000/api/oauth/callback`
  - `https://subsync-king-iyenes-projects.vercel.app/api/oauth/callback`
- Scopes (**Select Scope** dropdown): `locations.readonly`, `contacts.readonly`, `opportunities.readonly`, `calendars.readonly`, `conversations.readonly`. Add more only when a feature needs them. Whether minting location tokens or listing installed locations needs extra scopes is still unconfirmed.

## 6. Modules

- Custom Pages: enable, iframe URL `https://subsync-king-iyenes-projects.vercel.app/app`, enable SSO.
- Webhooks: add the webhook URL once `/api/webhooks` exists (later step). Subscribe to install/uninstall first.

## 7. Manage > Versions and Secrets

- **Client Keys > Add**: name it `subsync`, save. Copy the **Client Secret immediately** (shown once, after you click OK it is gone).
- **Shared Secret Key**: this is the SSO key used to decrypt the user context.

Send back: Client ID, Client Secret, Shared Secret Key. These go into `.env.local` and Vercel as `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`, `GHL_SSO_KEY`.

## 8. Test

My Apps > SubSync > Manage > Versions > three dots > Test Link, enter your Location ID, open the link, click Install. Note: the agency is on the $97 Starter plan, so agency-level private app install may not be allowed. If it is blocked, use the GHL sandbox account.
