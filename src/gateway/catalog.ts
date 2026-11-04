import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type CatalogModel = {
  provider: string;
  model: string;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  contextWindow: number;
  priceSource: string;
};

export type Catalog = {
  version: string;
  models: CatalogModel[];
  routes: Record<string, string[]>; // route name -> ordered "provider/model" candidates
};

export function loadCatalog(path = join(import.meta.dirname, '../../config/catalog.json')): Catalog {
  return JSON.parse(readFileSync(path, 'utf8')) as Catalog;
}

export function findModel(catalog: Catalog, provider: string, model: string): CatalogModel | undefined {
  return catalog.models.find((m) => m.provider === provider && m.model === model);
}

// Cost in USD for one call. Rounded to 6 decimals to match numeric(12,6) in Postgres.
export function costUsd(entry: CatalogModel | undefined, promptTokens: number, completionTokens: number): number {
  if (!entry) return 0;
  const raw = (promptTokens * entry.inputUsdPerMTok + completionTokens * entry.outputUsdPerMTok) / 1_000_000;
  return Math.round(raw * 1e6) / 1e6;
}
