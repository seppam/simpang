-- Milestone 2: routing, fallback, pricing and quotas.

-- Monthly token budget per tenant. NULL = unlimited.
ALTER TABLE tenants ADD COLUMN monthly_token_limit bigint CHECK (monthly_token_limit IS NULL OR monthly_token_limit >= 0);

ALTER TABLE usage_events
  ADD COLUMN route            text,                         -- e.g. "fast" when called as simpang/fast
  ADD COLUMN attempt          smallint NOT NULL DEFAULT 1,  -- 2+ = this row is a fallback attempt
  ADD COLUMN estimated        boolean  NOT NULL DEFAULT false, -- tokens counted by us, not the vendor
  ADD COLUMN catalog_version  text,                         -- which price list produced cost_usd
  ADD COLUMN error_kind       text,                         -- rate_limit, timeout, not_found, ...
  ADD COLUMN driver           text;                         -- "name@version" for agent driver calls

-- Provider health over a recent window ("error rate of groq in the last 10 minutes").
CREATE INDEX usage_events_provider_time ON usage_events (provider, created_at);
