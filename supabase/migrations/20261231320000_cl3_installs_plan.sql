-- Marketplace installs block (Clients, Money). Additive only.
-- The platform's installed list (GET /oauth/installedLocations, permission oauth.readonly) also returns, per client account, the plan the app is on and whether it is on a trial.
-- We keep both next to the install row so the Clients screen can show them. Only values the platform returned are stored.
do $$
begin
  alter table public.cl3_app_installs add column if not exists plan_id text;
  alter table public.cl3_app_installs add column if not exists on_trial boolean;
exception when undefined_table then
  null;
end $$;
