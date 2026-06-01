import { join } from 'node:path';
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { config } from '../../config.js';
import { ollamaClient } from '../../ollama/client.js';
import { getCached, setCached } from '../../ollama/embed-cache.js';
import type { ToolDef } from '../types.js';

const VectorSearchInput = z.object({
  query: z.string().min(1).max(2000),
  topK: z.number().int().min(1).max(20).default(5),
});

export type VectorSearchResult = {
  filePath: string;
  startOffset: number;
  endOffset: number;
  text: string;
  score: number;
};

interface ChunkRow {
  hnsw_label: number;
  file_path: string;
  start_offset: number;
  end_offset: number;
  text: string;
}

type HnswIndex = {
  readIndexSync(path: string): void;
  getCurrentCount(): number;
  searchKnn(query: number[], k: number): { neighbors: number[]; distances: number[] };
};

type HnswConstructor = new (space: 'cosine', dimensions: number) => HnswIndex;

// Lazy-initialized read-only handles shared across invocations
let _db: Database.Database | null = null;
let _hnsw: HnswIndex | null = null;

async function loadHnswConstructor(): Promise<HnswConstructor> {
  // hnswlib-node is a native module; load it only when vector search is used so
  // backend startup and non-vector smoke tests do not depend on native addon init.
  const mod = await import('hnswlib-node');
  const candidate = mod.default as { HierarchicalNSW?: HnswConstructor };
  if (!candidate.HierarchicalNSW) {
    throw new Error('hnswlib-node HierarchicalNSW export not found');
  }
  return candidate.HierarchicalNSW;
}

async function getStore(): Promise<{ db: Database.Database; hnsw: HnswIndex } | { error: string }> {
  const dbPath = join(config.VECTOR_DB_PATH, 'chunks.db');
  const hnswPath = join(config.VECTOR_DB_PATH, 'index.hnsw');

  if (!existsSync(dbPath) || !existsSync(hnswPath)) {
    return { error: 'Vector index not found — run indexCodebase job first' };
  }

  if (!_db) {
    _db = new Database(dbPath, { readonly: true });
  }
  if (!_hnsw) {
    const HierarchicalNSW = await loadHnswConstructor();
    _hnsw = new HierarchicalNSW('cosine', 768);
    _hnsw.readIndexSync(hnswPath);
  }

  return { db: _db, hnsw: _hnsw };
}

export const vectorSearchTool: ToolDef = {
  name: 'vector_search',
  description:
    'Search the indexed codebase using semantic similarity. Returns the most relevant code chunks matching the query.',
  safety: 'read',
  parameters: {
    type: 'object',
    required: ['query'],
    properties: {
      query: {
        type: 'string',
        description: 'Natural language or code query to search for',
      },
      topK: {
        type: 'number',
        description: 'Number of results to return (1-20, default 5)',
      },
    },
  },

  async execute(args): Promise<string> {
    const parsed = VectorSearchInput.safeParse(args);
    if (!parsed.success) {
      return JSON.stringify({ error: parsed.error.flatten().fieldErrors });
    }
    const { query, topK } = parsed.data;

    const store = await getStore();
    if ('error' in store) {
      return JSON.stringify({ error: store.error });
    }
    const { db, hnsw } = store;

    let queryEmbedding: number[];
    try {
      const cached = getCached(config.OLLAMA_EMBED_MODEL, query);
      if (cached) {
        queryEmbedding = cached;
      } else {
        const embeddings = await ollamaClient.embed(config.OLLAMA_EMBED_MODEL, [query]);
        const first = embeddings[0];
        if (!first) return JSON.stringify({ error: 'Embed returned empty result' });
        queryEmbedding = first;
        setCached(config.OLLAMA_EMBED_MODEL, query, queryEmbedding);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ error: `Embed failed: ${msg}` });
    }

    const total = hnsw.getCurrentCount();
    if (total === 0) return JSON.stringify({ results: [] });

    const actualK = Math.min(topK, total);
    const { neighbors, distances } = hnsw.searchKnn(queryEmbedding, actualK);

    if (neighbors.length === 0) return JSON.stringify({ results: [] });

    const placeholders = neighbors.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT hnsw_label, file_path, start_offset, end_offset, text FROM chunks WHERE hnsw_label IN (${placeholders})`)
      .all(...neighbors) as ChunkRow[];

    const labelToScore = new Map<number, number>(
      neighbors.map((label, i): [number, number] => [label, 1 - (distances[i] ?? 0)])
    );

    const results: VectorSearchResult[] = rows
      .map((row) => ({
        filePath: row.file_path,
        startOffset: row.start_offset,
        endOffset: row.end_offset,
        text: row.text,
        score: labelToScore.get(row.hnsw_label) ?? 0,
      }))
      .sort((a, b) => b.score - a.score);

    return JSON.stringify({ results });
  },
};
