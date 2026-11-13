-- Deal rules: "Count deals that look like tests" (Settings, Targets). One switch per company. Additive and idempotent.
-- null or false (default): deals whose name has a whole test word (test, demo, dummy, sample, lorem) stay left out of every dollar figure. true: they count like any other deal.
alter table public.settings add column if not exists count_test_deals boolean;
