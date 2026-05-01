import { config } from '../config.js';
import type { FlagsRepo, FeatureFlag } from '../db/repos/flags.js';

interface CacheEntry {
  value: unknown;
  fetchedAt: number;
}

export class FlagsService {
  private cache = new Map<string, CacheEntry>();

  constructor(private repo: FlagsRepo) {}

  getFlag(key: string): unknown | undefined {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < config.FLAG_CACHE_TTL_MS) {
      return cached.value;
    }
    const row = this.repo.get(key);
    if (!row) return undefined;
    const value = JSON.parse(row.value) as unknown;
    this.cache.set(key, { value, fetchedAt: Date.now() });
    return value;
  }

  setFlag(key: string, value: unknown, description?: string): void {
    this.repo.set(key, JSON.stringify(value), description);
    this.cache.delete(key);
  }

  listFlags(): FeatureFlag[] {
    const rows = this.repo.list();
    // Refresh cache entries for all listed flags
    for (const row of rows) {
      try {
        const value = JSON.parse(row.value) as unknown;
        this.cache.set(row.key, { value, fetchedAt: Date.now() });
      } catch {
        // ignore malformed JSON
      }
    }
    return rows;
  }
}
