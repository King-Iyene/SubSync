# How to test Speed to lead (use a throwaway CRM account you own)

Nothing here has been tested on a real CRM account yet. Use a test account, never a client.

## 0. Before you start
- Install SubSync on the test account. Wait for the first sync (Sync now popup shows what came in).
- Switches in Vercel (Production): WRITE_GHL_LIVE=true is on. SEND_EMAIL_LIVE and SEND_SLACK_LIVE stay off until step 6; until then emails and Slack are dry-run (shown in Log, not sent).

## 1. Race / Pace (does it measure?)
1. In the CRM create a contact (new lead) with your own phone.
2. Reply to it as a person (text or call). Wait about 45 s.
3. Speed > Race: the lead shows with its wait time. Click the count: you see that exact person.
4. Send an automatic message only: the clock must NOT stop. Only a person's reply stops it.

## 2. Coverage and Call mode (missed calls)
1. Call the test number from your phone and do not answer. Wait about 45 s.
2. Coverage > "Missed calls nobody called back" counts it. Call mode > "Missed calls, no callback" lists the same person (fix in progress, see note below).
3. Call them back from the CRM. The person leaves the list.

## 3. Call mode queue and the workflow automation (the moat)
1. Settings > Workflow setup: press Set up. It creates the "Lead Response Automations" folder with the call-queue workflow. If the CRM refuses (403 WORKFLOW_API_NOT_ENABLED), follow the 5-step guide shown there. This is the part most likely to need a fix on first real run.
2. Tag a test contact `call-now` in the CRM. The workflow puts a Manual Action "Call" in the CRM Manual Actions page and removes the tag.
3. In Call mode press Start, pick a list, press an outcome (answered, no answer, voicemail). Check the CRM: a note is written and the contact updated. SubSync never places a call itself.
4. Auto mode (off by default): turn it on for the test account with a small cap and check it adds only the capped number of leads.

## 4. Rules and alerts
1. Rules: set the target to 1 minute and quiet hours off.
2. Create a lead and do not reply. Log shows the breach alert (in-app). Escalation steps appear in order.

## 5. Lead panel (write-through)
Open any lead: send a text, add a note, add a tag, change owner. Check each in the CRM. Delete asks you to type the confirmation.

## 6. Email and Slack (only when ready)
Set SEND_EMAIL_LIVE=true, redeploy, send the digest to yourself. Slack needs the redirect URL step first.

## What to tell me
For each step: worked / did not, plus a screenshot of the CRM side.

See also docs/TEST_AUTOMATIONS_GUIDE.md (one section per automation) and scripts/automation-readiness.mts (read-only report).
