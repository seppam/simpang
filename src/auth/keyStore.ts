export type ActiveKey = {
  apiKeyId: string;
  tenantId: string;
  tenantName: string;
};

// Where keys live is a detail: Postgres in the app, an in-memory map in unit tests.
export interface KeyStore {
  findActiveKey(hash: string): Promise<ActiveKey | null>;
}
