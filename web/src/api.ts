// Every call the console makes to the gateway goes through this module.
// Shapes match src/routes/admin.ts and src/routes/oauth.ts on the server.
import { consoleSession, type Role, type SessionStore } from './session';

export class ApiError extends Error {
  readonly status: number; // 0 = the gateway could not be reached
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// ---- Response shapes -------------------------------------------------------

export type MeResponse = { clientId: string; tenantId: string | null; role: Role };

export type UsageRow = {
  day: string; // YYYY-MM-DD
  provider: string;
  model: string;
  requests: number;
  errors: number;
  tokens: number;
  costUsd: number;
};
export type UsageResponse = { days: number; data: UsageRow[] };

export type ProviderStatus = {
  name: string;
  circuitOpen: boolean;
  consecutiveFailures: number;
  models: string[];
  requests: number; // last 15 minutes
  errors: number;
  errorRate: number; // 0..1
  p95LatencyMs: number;
};
export type ProvidersResponse = {
  data: ProviderStatus[];
  routes: Record<string, string[]>; // route name -> ordered "provider/model" chain
  catalogVersion: string;
};

export type TenantRow = { id: string; name: string; monthlyTokenLimit: number | null; usedThisMonth: number };
export type TenantsResponse = { data: TenantRow[] };

export type KeyRow = {
  id: string;
  tenantId: string;
  tenantName: string;
  prefix: string;
  createdAt: string;
  revokedAt: string | null;
};
export type KeysResponse = { data: KeyRow[] };
export type CreatedKey = { id: string; key: string; prefix: string; note: string };

export type EvalMetrics = Record<string, number>;
export type EvalEntry = { metrics: EvalMetrics; createdAt: string; gitSha: string };
export type ShadowSummary = {
  driver: string;
  stableVersion: string;
  canaryVersion: string;
  runs: number;
  agreeRate: number | null; // 0..1
  errors: number;
  avgStableLatencyMs: number;
  avgCanaryLatencyMs: number | null;
  stableCostUsd: number;
  canaryCostUsd: number | null;
};
export type DriverInfo = {
  name: string;
  versions: string[];
  channels: { stable: string; canary?: string } | undefined;
  description: string | undefined;
  eval: Record<string, EvalEntry | null>;
  shadow: ShadowSummary[];
};
export type DriversResponse = { data: DriverInfo[] };

export type TokenResponse = { access_token: string; token_type: 'Bearer'; expires_in: number; role: Role };

// ---- Error handling --------------------------------------------------------

const FALLBACK_MESSAGES: Record<number, string> = {
  401: 'Your session is no longer valid. Sign in again.',
  403: 'Your role does not allow this action.',
  404: 'Not found.',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

// Two error shapes exist: the /admin API ({ error: { type, code, message } }) and the
// OAuth endpoint ({ error, error_description }, RFC 6749).
export function parseApiError(status: number, payload: unknown): ApiError {
  const body = asRecord(payload);
  const fallback = FALLBACK_MESSAGES[status] ?? `Request failed with status ${status}.`;
  const nested = asRecord(body?.error);
  if (nested) {
    return new ApiError(status, String(nested.code ?? 'error'), String(nested.message ?? fallback));
  }
  if (typeof body?.error === 'string') {
    const description = typeof body.error_description === 'string' ? body.error_description : fallback;
    return new ApiError(status, body.error, description);
  }
  return new ApiError(status, 'http_error', fallback);
}

// ---- Client ----------------------------------------------------------------

export type ApiOptions = {
  session: SessionStore;
  fetch?: typeof fetch;
};

export function createApi({ session, fetch: fetchImpl = (...args) => globalThis.fetch(...args) }: ApiOptions) {
  async function call<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, options: { body?: unknown; auth?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    const needsAuth = options.auth !== false;
    if (needsAuth) {
      const token = session.activeToken();
      if (!token) throw new ApiError(401, 'session_expired', FALLBACK_MESSAGES[401]);
      headers.authorization = `Bearer ${token}`;
    }
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    let response: Response;
    try {
      response = await fetchImpl(path, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: 'no-store',
      });
    } catch {
      throw new ApiError(0, 'network_error', 'Cannot reach the gateway. Check the connection and retry.');
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      // A 401 on an authenticated call means the token was rejected: sign out everywhere.
      if (response.status === 401 && needsAuth) session.end('expired');
      throw parseApiError(response.status, payload);
    }
    return payload as T;
  }

  const me = () => call<MeResponse>('GET', '/admin/me');

  return {
    async login(clientId: string, clientSecret: string): Promise<void> {
      const token = await call<TokenResponse>('POST', '/oauth/token', {
        auth: false,
        body: { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret },
      });
      session.start({ token: token.access_token, expiresInSeconds: token.expires_in, role: token.role, clientId });
      const who = await me();
      session.update({ clientId: who.clientId, tenantId: who.tenantId });
    },

    signOut(): void {
      session.end('signed-out');
    },

    me,

    usage(days: number, tenant?: string) {
      const query = new URLSearchParams({ days: String(days) });
      if (tenant) query.set('tenant', tenant);
      return call<UsageResponse>('GET', `/admin/usage?${query}`);
    },

    providers: () => call<ProvidersResponse>('GET', '/admin/providers'),

    tenants: () => call<TenantsResponse>('GET', '/admin/tenants'),

    setQuota: (tenantId: string, monthlyTokenLimit: number | null) =>
      call<{ ok: true }>('PATCH', `/admin/tenants/${encodeURIComponent(tenantId)}/quota`, { body: { monthlyTokenLimit } }),

    keys: () => call<KeysResponse>('GET', '/admin/keys'),

    createKey: (tenantId?: string) =>
      call<CreatedKey>('POST', '/admin/keys', { body: tenantId ? { tenantId } : {} }),

    revokeKey: (keyId: string) => call<{ ok: true }>('DELETE', `/admin/keys/${encodeURIComponent(keyId)}`),

    drivers: () => call<DriversResponse>('GET', '/admin/drivers'),
  };
}

export const api = createApi({ session: consoleSession });
