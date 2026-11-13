# Workflows probe: does automatic call queue setup work on this account?

Run it once after you reinstall (or press Update and allow the workflow permissions) in KD Squares Test. It is read only unless you add `--create`. It never prints a token.

## Run

1. Find the account's location id (the id in the CRM address bar for that account).
2. In the project folder:
   - Read only: `node --env-file=.env.local --import tsx scripts/probe-workflows.ts --location <locationId>`
   - Also test creating: add `--create` (needs `WRITE_GHL_LIVE=true` in `.env.local`; it makes a draft named "SubSync probe" with no folder, then deletes only that draft by its own id. If it cannot be sure it is the right one, it tells you to delete it by hand).
3. Copy everything it prints and paste it back to me.

## What each line means

| Line | Meaning | What to do |
|---|---|---|
| `[FAIL] ... NOT granted` | The app was not given the two optional workflow permissions. | Reinstall or press Update in the CRM and allow them (docs/RELEASE_1_1_0.md section 1B). |
| `[FAIL] Get Step Types failed (not_enabled ...)` | The CRM has not turned on its Workflows API for this app or account (403 WORKFLOW_API_NOT_ENABLED_FOR_LOCATION). | Send docs/WORKFLOWS_API_SUPPORT_MESSAGE.md. Until then the card shows the 2-minute hand-built steps. |
| `[FAIL] Get Step Types failed (missing_scope ...)` | A 401 or 403 that is not the "not enabled" kind: permission missing or token problem. | Reinstall, then run again. |
| `[FAIL] Missing step types: ...` | The CRM does not list one of the three steps we need. The probe prints every step type. | Paste the list back; I adjust the matcher. |
| `[ OK ] Found: trigger ..., action ...` | The three step ids we will use, read live. | Nothing. |
| `[ OK ] Workflow list: N workflows` | Reading works. | Nothing. |
| `[ OK ] Validate Workflow Definition: accepted` | The CRM accepts our call queue definition. This is the key result. | Nothing. |
| `[FAIL] Validate ... refused (rejected ...)` | The definition shape (UNVERIFIED field names) is wrong. | Paste the output back; I fix the builder. |
| `[ OK ] Created draft "SubSync probe"` then `Deleted the probe draft.` | Create and delete both work. | Nothing. |

Everything on the API side is UNVERIFIED until this has run once on a location where the Workflows API is enabled.
