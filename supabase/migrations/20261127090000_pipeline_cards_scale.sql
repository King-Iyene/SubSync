-- Pipeline cards and stage aggregates at 1M+ deals: one covering index so the per-pipeline totals are answered from the index alone. Additive only.
create index if not exists cached_opportunities_pipe_agg_idx
  on public.cached_opportunities (installation_id, location_id, pipeline_id, status)
  include (stage_id, monetary_value, assigned_to, last_stage_change_at, last_status_change_at, synced_at);
