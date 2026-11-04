-- Milestone 5: OAuth2 client credentials and role-based access for the control surface.
-- API keys (sk_...) call models. OAuth clients (operators, dashboards, other services)
-- manage the platform. Different credentials for different jobs = least privilege.
CREATE TABLE oauth_clients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id     text NOT NULL UNIQUE,            -- public identifier, e.g. "cl_..."
  secret_hash   text NOT NULL,                   -- SHA-256 of the secret, like API keys
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Who changed what in the control plane (key created, quota changed, ...).
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid REFERENCES tenants(id) ON DELETE SET NULL,
  actor       text NOT NULL,     -- client_id of the caller
  action      text NOT NULL,     -- e.g. "api_key.create"
  target      text,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_time ON audit_log (tenant_id, created_at);
