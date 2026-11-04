-- Milestone 4: evaluation results and shadow traffic.

-- Shadow traffic: real stable-version calls replayed on the canary version.
-- Holds tenant input, so it is kept short-term and only for tenants that allow it (see docs).
CREATE TABLE shadow_runs (
  id                 bigserial PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  driver             text NOT NULL,
  stable_version     text NOT NULL,
  canary_version     text NOT NULL,
  input              jsonb NOT NULL,
  stable_output      jsonb,
  canary_output      jsonb,
  agree              boolean,         -- NULL = free text, needs human review
  stable_latency_ms  integer NOT NULL,
  canary_latency_ms  integer,
  stable_cost_usd    numeric(12, 6) NOT NULL,
  canary_cost_usd    numeric(12, 6),
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shadow_runs_driver_time ON shadow_runs (driver, canary_version, created_at);

-- Offline evaluation runs (dataset x driver version), so baselines and history live in the DB too.
CREATE TABLE eval_runs (
  id            bigserial PRIMARY KEY,
  driver        text NOT NULL,
  version       text NOT NULL,
  dataset       text NOT NULL,
  dataset_hash  text NOT NULL,     -- the exact dataset content that was used
  metrics       jsonb NOT NULL,    -- accuracy per field, schema-valid rate, latency, cost per task...
  passed_gate   boolean,
  git_sha       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
