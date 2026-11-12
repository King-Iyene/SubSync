-- How a sale is counted (Settings, "How do we count a sale?"): one choice per company. Additive and idempotent.
-- sale_basis: deal_won (default) | payment | assigned_closer. sale_count_without_value: count a sale even when the deal carries no dollar value (default on, so nothing changes until a company chooses).
alter table public.settings add column if not exists sale_basis text;
alter table public.settings add column if not exists sale_count_without_value boolean;
