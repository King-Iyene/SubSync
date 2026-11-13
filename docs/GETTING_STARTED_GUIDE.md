# Getting started with SubSync

For the person who has just installed SubSync. It takes about ten minutes, most of it waiting for the first read of your accounts.

## 1. Open it

Open SubSync from the left menu of your CRM. The first time, it reads your client accounts in the background: contacts, deals, conversations (who wrote last and when, never the words) and appointments. A bar says "First sync in progress" until the first read is done. Large accounts take a few minutes; the numbers fill in as it goes.

## 2. Read the first screen

**Today** opens with three sentences, in this order:
1. how many leads are waiting for a reply (leads go cold in minutes, so this comes first),
2. how many past appointments have no outcome recorded (so the show rate is a guess),
3. how many client accounts need attention.

Under them: the one thing to do first, what changed against each account's own last week, and the accounts that need you.

## 3. Run the audit

**Account audit** shows what is wrong right now and what it costs, with counted facts kept apart from estimates. Press **Share link** to make a page you can send to a client or a prospect: it shows totals, what we found and a one-page fix plan, with no client names, works for 14 days, and you can switch it off at any time. Press **Print** for a page you can hand over on paper.

## 4. Set your targets (two minutes)

In **Settings**, Rules and targets:
- **Reply target for new leads** (minutes): how fast a person should answer a new lead. The default is 15.
- **Reply SLA** (hours): how long a message may wait before it counts as waiting. The default is 4.
- **Stale deal after** (days) and **Gone quiet after** (days).
- Optional: **Only count business hours**, if nobody answers at night.

## 5. Add your email for alerts

In Settings, Alerts and connections, type one email address. You will get a short brief every Monday and an email when something needs you (warnings wait for the morning; critical ones come at once). Every email has a link to stop it.

## 6. Tell it who is who

Open **Team** and type names for the people shown by an id (the platform only gives SubSync an id). Replies and appointments are then shown by name.

## 7. Optional: AI wording for your 7 am brief

In **Settings, Integrations, AI** you can connect your own AI account: **Connect with OpenRouter** (one click; uses your OpenRouter credit), **Sign in with ChatGPT** (shown as "coming" until OpenAI approves our app), or **Paste an API key** from Anthropic, OpenAI, Google Gemini or any OpenAI-compatible service (billed by that provider to you). Set a monthly limit, press **Preview a sample** to see what it writes and exactly what was sent. A ChatGPT or Claude chat subscription cannot be used with a key. It only suggests; it never messages a lead or changes your CRM.

## What SubSync will never do

- It sends a text or email only when a person on your team presses Send, after a preview, and never to a contact who asked not to be contacted.
- It never copies the words of a conversation.
- It changes things in your CRM only if you use Data cleanup (preview first, type the number of changes to confirm, undo available) or switch on meeting notes for contacts.
- It never shows one client's data to another client. A client's own staff, if you switch that on, see a read-only view of their own account only.

## If something looks wrong

Press **Sync now** on Today. If a number still looks wrong, tell us which account and which number: code@kdsquares.com.

## 8. Optional: Ask your data, and AI help in Clean-up

Once your own AI account is connected (section 7), switch the jobs on in **Settings, Integrations, AI** (each job has its own switch, off until you turn it on for the account).

- **Ask your data** (Today, or press Ctrl K, type a question ending with a question mark, then Enter; Alt+Enter also works). Examples: "How many leads are waiting?", "Which client had the slowest first replies?", "What is my show rate?". The answer is short, says which dates it used (the date bar at the top sets them), and each number has a **Rows** button that opens exactly the rows it counted. If a question is not about your data, it says so. Your questions are private to you; **Show my earlier questions** lets you delete them (type delete to confirm). Client staff only ever see their own account.
- **Clean-up, Overview, AI help with your data**: **Review my data** (a plain-English audit; each count opens its rows), **Suggest fixes** (needs "allow names" in the AI settings; shows a batch, then **Check these in Fix data** makes an ordinary preview that you confirm by typing the number, and can undo; the AI never applies, merges or deletes anything) and **Check this account's setup** (calendars with no owner, pipelines with too few stages, no call queue workflow, missing standard automations, missing permissions).
- **Duplicates**: on a Likely or Possible group, **AI opinion** says same person, different people or not sure, with reasons. It never merges, and if the names are different people's names it can never say "same". You still pick.
