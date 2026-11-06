# Tag dates for old tags

Question: can SubSync learn WHEN a tag was added to a contact, for tags that were there before SubSync started watching?

## Answer: no documented way (checked 2026-11-14, public OpenAPI files only, no live calls)

Source: https://github.com/GoHighLevel/highlevel-api-docs (folder `apps/`: contacts.json, conversations.json, workflows.json, locations.json, users.json, opportunities.json).

- VERIFIED (contacts.json): the contact object has `tags` (a plain list of names), `dateAdded` and `dateUpdated`. No per-tag timestamp, no "added by". `dateUpdated` moves on any edit, so it cannot date a tag.
- VERIFIED (contacts.json): the only tag endpoints are Add Tags, Remove Tags and Bulk Update Tags (all writes). No endpoint lists tag history.
- VERIFIED (contacts.json): contact sub-resources are tasks and notes only. No activity, timeline, history or audit-log endpoint on contacts, workflows, locations, users or opportunities (searched every path and summary for audit, activity, timeline, history, event).
- INFERENCE (not usable yet): conversations.json lists message types `TYPE_ACTIVITY_CONTACT` and `TYPE_ACTIVITY_EMPLOYEE_ACTION_LOG`. The CRM's own timeline shows rows such as "tag added" in the conversation, so these may carry a tag change with a time and a user. The docs do not say what the body or meta contain, and it needs a live read to confirm (and the conversation messages permission). CHECK before building a backfill: read one real conversation that had a tag added, and see whether such a row appears and what it contains.

Decision: no backfill is built, because no documented endpoint exists and the INFERENCE route is unproven. Nothing is guessed or written.

## What SubSync shows instead
- Tag SubSync itself added or removed: exact time (`contact_tag_events.exact = true`).
- Tag seen being added at a sync, including those triggered by a live tag-update event (the event starts a resync within minutes): the day SubSync first saw it. Tooltip says the CRM does not record when.
- Tag already there before SubSync watched: chip says "before SubSync"; tooltip says the CRM does not date tags.

## If the activity rows prove usable (next step)
Read them on demand for one contact (bounded, rate-limited, scope conversations/message.readonly, optional), write one idempotent `contact_tag_events` row per tag change with `exact = true` and the user, tenant-scoped, metadata only. Needs a live confirmation first.
