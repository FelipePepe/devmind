/**
 * Module-level LRU + TTL cache for Ollama text embeddings.
 *
 * Keyed by `model:text` hash. Useful for:
 * - vector_search queries (same query repeated across agent loop iterations)
 * - Any batch where the same chunk appears multiple times
 *
 * Max 512 entries × ~3 KB per 768-dim embedding ≈ 1.5 MB ceiling.
 */

import { createHash } from 'node:crypto';

interface Entry {
  embedding: number[];
  expiresAt: number;
}

const MAX_ENTRIES = 512;
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

const cache = new Map<string, Entry>();

let hits = 0;
let misses = 0;

function evictExpiredAndOverflow(): void {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expiresAt < now) cache.delete(k);
  }
  while (cache.size >= MAX_ENTRIES) {
    cache.delete(cache.keys().next().value!);
  }
}

function cacheKey(model: string, text: string): string {
  const hash = createHash('sha1').update(text).digest('hex');
  return `${model}:${hash}`;
}

export function getCached(model: string, text: string): number[] | undefined {
  const entry = cache.get(cacheKey(model, text));
  if (!entry || entry.expiresAt < Date.now()) {
    misses++;
    return undefined;
  }
  hits++;
  // Refresh LRU position
  cache.delete(cacheKey(model, text));
  cache.set(cacheKey(model, text), entry);
  return entry.embedding;
}

export function setCached(model: string, text: string, embedding: number[], ttlMs = DEFAULT_TTL_MS): void {
  evictExpiredAndOverflow();
  cache.set(cacheKey(model, text), { embedding, expiresAt: Date.now() + ttlMs });
}

export function getEmbedCacheStats(): { size: number; hits: number; misses: number; hitRate: string } {
  const total = hits + misses;
  return {
    size: cache.size,
    hits,
    misses,
    hitRate: total === 0 ? 'n/a' : `${Math.round((hits / total) * 100)}%`,
  };
}
