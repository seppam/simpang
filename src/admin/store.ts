import type { Role } from '../auth/rbac.ts';

export type OAuthClient = { id: string; tenantId: string; clientId: string; secretHash: string; role: Role; name: string; revoked: boolean };

// tenantId = null means "all tenants" (only for callers with platform:all-tenants).
export type Scope = string | null;

export type UsageRow = { day: string; provider: string; model: string; requests: number; errors: number; tokens: number; costUsd: number };
export type ProviderHealth = { provider: string; requests: number; errors: number; errorRate: number; p95LatencyMs: number };
export type TenantRow = { id: string; name: string; monthlyTokenLimit: number | null; usedThisMonth: number };
export type KeyRow = { id: string; tenantId: string; tenantName: string; prefix: string; createdAt: string; revokedAt: string | null };
export type ShadowSummary = { driver: string; stableVersion: string; canaryVersion: string; runs: number; agreeRate: number | null; errors: number; avgStableLatencyMs: number; avgCanaryLatencyMs: number | null; stableCostUsd: number; canaryCostUsd: number | null };

// Everything the control surface reads or changes. Postgres in the app, fakes in unit tests.
export interface AdminStore {
  findClient(clientId: string): Promise<OAuthClient | null>;
  usage(scope: Scope, days: number): Promise<UsageRow[]>;
  providerHealth(minutes: number): Promise<ProviderHealth[]>;
  tenants(scope: Scope): Promise<TenantRow[]>;
  setQuota(tenantId: string, limit: number | null): Promise<boolean>;
  keys(scope: Scope): Promise<KeyRow[]>;
  createKey(tenantId: string): Promise<{ id: string; key: string; prefix: string }>;
  revokeKey(scope: Scope, keyId: string): Promise<boolean>;
  shadow(scope: Scope): Promise<ShadowSummary[]>;
  audit(entry: { tenantId: string | null; actor: string; action: string; target?: string; detail?: unknown }): Promise<void>;
}
