-- Plan monitor (Clients). Additive only.
-- 1) The change record (cl3_history) may now hold 'app_plan': the SubSync plan on a client account changed between two reads of the installed list.
-- 2) The last charge SubSync's own billing made to a client account (permission charges.readonly), kept next to the install row. Only values the platform returned are stored.
do $$
begin
  alter table public.cl3_history drop constraint if exists cl3_history_kind_check;
  alter table public.cl3_history add constraint cl3_history_kind_check check (kind in ('plan', 'status', 'wallet_low', 'app_installed', 'app_removed', 'app_plan'));
exception when undefined_table then
  null;
end $$;

do $$
begin
  alter table public.cl3_app_installs add column if not exists charges_state text;
  alter table public.cl3_app_installs add column if not exists charges_at timestamptz;
  alter table public.cl3_app_installs add column if not exists last_charge_at timestamptz;
  alter table public.cl3_app_installs add column if not exists last_charge_amount numeric;
  alter table public.cl3_app_installs add column if not exists last_charge_currency text;
exception when undefined_table then
  null;
end $$;
