-- Additive. 13 Nov 2026: the marketplace app has one plan, Growth ($11.50 per client account per month, 14-day
-- free trial). The Growth plan is stored with tier 'pro' (the tier column only allows free or pro); the app names
-- it "growth". The deleted Free Plan stays mapped as LEGACY with full access so existing installs keep working.
-- Also records when a trial started, so an ended trial can be shown as ended. No data is changed or removed.
insert into public.plan_entitlements (plan_id, tier, note) values
  ('6af521842a5c6a72fd97d767', 'pro', 'Growth, $11.50 per client account per month, 14-day free trial'),
  ('6ae40eb4f65e3c03823476b8', 'pro', 'LEGACY deleted Free Plan: kept at full access so existing installs do not lose anything')
on conflict (plan_id) do nothing;

alter table public.install_plans add column if not exists trial_started_at timestamptz;
