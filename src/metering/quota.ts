export type QuotaStatus = { allowed: true } | { allowed: false; limit: number; used: number };

// Checked before any provider is called: a tenant over budget costs us nothing.
export interface QuotaGuard {
  check(tenantId: string): Promise<QuotaStatus>;
}

export const unlimited: QuotaGuard = { check: async () => ({ allowed: true }) };
