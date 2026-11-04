// One provider attempt through the gateway. The basis for quotas, dashboards and billing.
export type UsageEvent = {
  tenantId: string;
  apiKeyId: string;
  provider: string;
  model: string;
  route?: string; // set when the caller asked for a route like "simpang/fast"
  attempt?: number; // 1 = first candidate, 2 = first fallback, ...
  promptTokens: number;
  completionTokens: number;
  estimated?: boolean; // tokens counted by us, not reported by the vendor
  costUsd: number;
  catalogVersion?: string; // which price list was used
  latencyMs: number;
  status: 'ok' | 'error';
  errorKind?: string;
  driver?: string; // "name@version" when the call came through an agent driver
};

export interface UsageSink {
  record(event: UsageEvent): Promise<void>;
}
