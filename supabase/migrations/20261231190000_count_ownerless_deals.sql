-- Deal rules: "Count deals without an owner" (Settings, Targets). One switch per company. Additive and idempotent.
-- null or false (default): open deals that have a value but no assigned owner stay left out of Pipeline money (and are said out loud, with a count). true: they count like any other deal.
alter table public.settings add column if not exists count_ownerless_deals boolean;
