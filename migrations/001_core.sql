-- A tenant is one customer/product that calls the gateway (e.g. "portfolio-chat", "msp-ops").
CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- We never store the raw key: only a short prefix (to recognise it in the UI) and its SHA-256 hash.
CREATE TABLE api_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_prefix  text NOT NULL,
  key_hash    text NOT NULL UNIQUE,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per request through the gateway: the basis for quotas, dashboards and billing.
CREATE TABLE usage_events (
  id                 bigserial PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  api_key_id         uuid REFERENCES api_keys(id),
  provider           text NOT NULL,
  model              text NOT NULL,
  prompt_tokens      integer NOT NULL DEFAULT 0,
  completion_tokens  integer NOT NULL DEFAULT 0,
  cost_usd           numeric(12, 6) NOT NULL DEFAULT 0, -- numeric, not float: money must add up exactly
  latency_ms         integer,
  status             text NOT NULL CHECK (status IN ('ok', 'error')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- The most common question is "usage of tenant X in period Y", so index exactly that.
CREATE INDEX usage_events_tenant_time ON usage_events (tenant_id, created_at);
