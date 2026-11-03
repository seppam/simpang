// One provider call through the gateway. The basis for quotas, dashboards and billing.
export type UsageEvent = {
  tenantId: string;
  apiKeyId: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number; // 0 until the price catalogue arrives in milestone 2
  latencyMs: number;
  status: 'ok' | 'error';
};

export interface UsageSink {
  record(event: UsageEvent): Promise<void>;
}
