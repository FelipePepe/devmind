# Technical Design: 002-fase-6-vector-search

> **Status**: draft  
> **Change ID**: 002-fase-6-vector-search  
> **Date**: 2025-07-17  
> **Author**: sdd-design subagent

---

## 1. Architecture Overview

The feature introduces a two-process pipeline: **indexing** (workers sidecar) and **querying** (backend tool).

### Indexing pipeline

```
BullMQ-style poll loop (index.ts)
  └─ dispatch("indexCodebase")
       └─ indexCodebase(payload, jobs, jobId)          [workers/handlers/index-codebase.ts]
            ├─ collectFiles(repoPath)                   [node:fs — already in handler]
            ├─ sha256(fileContent) per file
            ├─ VectorIndexStore.getFileHashes()         [workers/vector/index-store.ts]
            │    └─ SELECT file_path, file_hash FROM chunks
            ├─ [skip unchanged files]
            ├─ VectorIndexStore.deleteChunksByFile()    for changed / deleted files
            ├─ chunkText(content)                       [workers/vector/chunker.ts]
            ├─ embedChunks(texts, ollamaClient, model)  [workers/vector/embedder.ts]
            │    └─ OllamaClient.embed(model, batch)   [backend/ollama/client.ts — imported via shared dep]
            └─ VectorIndexStore.addChunks(...)          [workers/vector/index-store.ts]
                  ├─ HNSW index.addPoint(embedding, label)
                  └─ SQLite INSERT INTO chunks (transaction)
```

> **Cross-package import note**: `OllamaClient` lives in `packages/backend`. Workers import it directly as a workspace dependency. The `hnswlib-node` dep stays in workers only; backend never touches HNSW.

### Query path

```
Agent loop (backend)
  └─ tool call: vector_search({ query, topK })         [backend/tools/impl/vector-search.ts]
       ├─ Zod input validation
       ├─ OllamaClient.embed("nomic-embed-text", [query])
       │    └─ POST /api/embed → number[][]
       ├─ IndexStore (backend-side, read-only SQLite + hnswlib)
       │    └─ hnsw.searchKnn(queryEmbedding, topK) → { neighbors, distances }
       ├─ chunks.db: SELECT * FROM chunks WHERE hnsw_id IN (...)
       └─ map → VectorSearchResult[] sorted by score desc
```

> **Isolation**: The backend vector-search tool opens `chunks.db` read-only and loads the HNSW index read-only. It never calls workers code directly. Both processes share only the files on disk at `VECTOR_DB_PATH`.

---

## 2. Architecture Decision Records

### ADR-01 — Use `hnswlib-node` for vector index

**Decision**: Use `hnswlib-node@^3.0.0` (already declared in workers `package.json`).

**Alternatives considered**:
| Option | Reason rejected |
|--------|----------------|
| `faiss-node` | Requires native BLAS libs; harder to build on ARM NAS |
| Pure-JS cosine scan | O(n) per query; unusable at >10 k chunks |
| External Weaviate / Qdrant | Additional Docker service; over-engineered for intranet scale |

**Rationale**: `hnswlib-node` compiles a single native addon, ships pre-built binaries for Node 22, supports cosine space, and persists the index to a single binary file. It satisfies the scale requirement (≤ 100 k elements) with sub-millisecond query times.

**Constraint**: `hnswlib-node` is **workers-only**. The backend cannot import it directly (no native addon in the backend process). The backend accesses the HNSW index by loading the saved binary file at query time via a thin wrapper — avoiding process coupling while still allowing read-only kNN queries.

---

### ADR-02 — Dual store: HNSW binary + SQLite

**Decision**: Store vectors in HNSW (`index.hnsw`) and metadata in SQLite (`chunks.db`) co-located in `VECTOR_DB_PATH`.

**Why not store text in HNSW?**: HNSW only stores float vectors. Chunk text, file paths, and offsets require a relational lookup.

**Why not Postgres / Redis?**: This is a single-user intranet; SQLite with WAL has sufficient write throughput for batch indexing. No network hop. Atomic WAL transactions keep HNSW labels and chunk rows in sync.

**Join mechanism**: Each HNSW vector is assigned an integer `label` (monotonically increasing). That same integer is stored as `hnsw_id` in the `chunks` table. A kNN search returns a list of labels; a single `WHERE hnsw_id IN (...)` lookup retrieves the full metadata.

---

### ADR-03 — Batch size 32 for embed requests

**Decision**: Split chunks into batches of at most 32 per `POST /api/embed` call.

**Rationale**:  
- Ollama's `/api/embed` accepts an array `input`; the server processes them sequentially on the GPU. Larger batches reduce HTTP overhead but risk OOM on models with large embedding dimensions.  
- `nomic-embed-text` produces 768-dimensional embeddings. 32 × 768 × 4 bytes ≈ 96 KB per batch — safely within typical Ollama memory budgets.  
- 32 keeps individual request latency predictable (< 2 s on a 7 B parameter GPU system) so workers don't time out.

---

### ADR-04 — Char-based chunking vs token-based

**Decision**: Sliding window by character count (800 chars, 200 overlap).

**Alternatives considered**:
| Option | Reason rejected |
|--------|----------------|
| Token-based chunking | Requires a tokenizer library; adds a heavy dependency for marginal gain at this codebase scale |
| Line-based chunking | Produces highly variable chunk sizes; long functions become single huge chunks |
| AST-based splitting | Complex to implement; overkill for an MVP vector search |

**Rationale**: Character windows are deterministic, zero-dependency, and produce roughly consistent token counts for Latin-script source code (≈ 200–250 tokens per 800 chars with nomic-embed-text's tokenizer). The 200-char overlap ensures a function signature or import statement that straddles a boundary appears in both adjacent chunks.

---

### ADR-05 — SHA-256 file hash for incremental detection

**Decision**: Compute `sha256(fileContent)` per file and compare against `file_hash` stored in `chunks.db`.

**Alternatives considered**:
| Option | Reason rejected |
|--------|----------------|
| `mtime` comparison | Unreliable across NFS/NAS mounts; can falsely match after `git checkout` |
| MD5 / CRC32 | Slightly faster but sha256 is already available via Node's built-in `node:crypto`; collision risk irrelevant here but uniformity preferred |
| Per-chunk hashing | Would require 800-char rolling hash; unnecessary complexity |

**Rationale**: A single sha256 digest per file is cheap (sub-ms for typical source files) and deterministic. Storing it in `file_hash` gives an O(1) skip decision without reading HNSW at all. The spec defines `file_hash` in the `chunks` table (same hash stored on every chunk row of a file) so the lookup is a simple `SELECT DISTINCT file_hash FROM chunks WHERE file_path = ?`.

---

## 3. Sequence Diagrams

### 3.1 Indexing flow

```
Worker poll loop          indexCodebase()        VectorIndexStore     OllamaClient     HNSW / SQLite
      │                         │                       │                  │                  │
      │── dequeueNext() ──────► │                       │                  │                  │
      │                         │── collectFiles() ─────────────────────────────────────────► │
      │                         │◄─ filePaths[] ─────────────────────────────────────────────  │
      │                         │── getFileHashes() ───► │                  │                  │
      │                         │◄─ Map<path,hash> ────  │                  │                  │
      │                         │                       │                  │                  │
      │          [for each file]│                       │                  │                  │
      │                         │── sha256(content) ─────────────────────────────────────────► │
      │                         │◄─ hash ────────────────────────────────────────────────────  │
      │                         │                       │                  │                  │
      │            [unchanged]  │── skip (log debug) ────────────────────────────────────────► │
      │                         │                       │                  │                  │
      │            [changed]    │── deleteChunksByFile() ► │                │                  │
      │                         │                       │── markDelete()                       │
      │                         │                       │── DELETE chunks ─────────────────── ► │
      │                         │◄── void ────────────  │                  │                  │
      │                         │                       │                  │                  │
      │                         │── chunkText(content) ──────────────────────────────────────► │
      │                         │◄─ Chunk[] ─────────────────────────────────────────────────  │
      │                         │                       │                  │                  │
      │                         │── embedChunks(texts) ─────────────────► │                  │
      │                         │                       │── embed(batch1) ► │                 │
      │                         │                       │◄─ number[][] ──   │                 │
      │                         │                       │   … repeat per batch                │
      │                         │◄─ number[][] ─────────────────────────── │                  │
      │                         │                       │                  │                  │
      │                         │── addChunks(...) ────► │                  │                  │
      │                         │                       │── addPoint() ─────────────────────► │
      │                         │                       │── INSERT chunks ──────────────────► │
      │                         │◄── void ────────────  │                  │                  │
      │                         │                       │                  │                  │
      │        [rebuild check]  │                       │── deletedRatio > 0.20?              │
      │                         │                       │── [if yes] rebuild(...)             │
      │                         │                       │                  │                  │
      │── updateStatus(done) ◄── │                       │                  │                  │
```

### 3.2 Query flow

```
Agent loop           vector_search tool         OllamaClient       HNSW (loaded)      chunks.db
     │                      │                        │                   │                 │
     │── tool_call ────────► │                        │                   │                 │
     │                      │── Zod.parse(input) ──────────────────────────────────────────►
     │                      │◄─ { query, topK } ───────────────────────────────────────────
     │                      │                        │                   │                 │
     │                      │── embed([query]) ──────► │                  │                 │
     │                      │◄─ [[...768 floats]] ──  │                  │                 │
     │                      │                        │                   │                 │
     │                      │── searchKnn(vec, topK) ─────────────────► │                 │
     │                      │◄─ { neighbors, distances } ───────────── │                  │
     │                      │                        │                   │                 │
     │                      │── SELECT * FROM chunks WHERE hnsw_id IN (...) ─────────────► │
     │                      │◄─ rows[] ─────────────────────────────────────────────────── │
     │                      │                        │                   │                 │
     │                      │── map rows → VectorSearchResult[]          │                 │
     │                      │── sort by score desc                       │                 │
     │◄─ JSON string ───────  │                        │                   │                 │
```

---

## 4. File Change Map

### New files

| File | Package | Description |
|------|---------|-------------|
| `packages/workers/src/vector/chunker.ts` | workers | Pure `chunkText()` function |
| `packages/workers/src/vector/embedder.ts` | workers | `embedChunks()` — batched embedding via OllamaClient |
| `packages/workers/src/vector/index-store.ts` | workers | `VectorIndexStore` class — HNSW + SQLite lifecycle |
| `packages/backend/src/tools/impl/vector-search.ts` | backend | `vector_search` tool — query path only |

### Modified files

| File | Package | Change |
|------|---------|--------|
| `packages/backend/src/ollama/client.ts` | backend | Update `embed()` signature: `(model: string, inputs: string[]): Promise<number[][]>` |
| `packages/workers/src/handlers/index-codebase.ts` | workers | Replace stub body with real incremental indexing algorithm |
| `packages/backend/src/tools/index.ts` | backend | Import and register `vectorSearchTool` |

### No changes required

- `packages/frontend/**` — untouched per spec constraint  
- `packages/backend/src/config.ts` — `VECTOR_DB_PATH` and `OLLAMA_EMBED_MODEL` already declared  
- `packages/workers/src/db.ts` — workers use their own separate `chunks.db`, not the shared app DB  
- Any migration in the main app SQLite — explicitly excluded by spec

---

## 5. Module Interfaces

### 5.1 `Chunk` type — `packages/workers/src/vector/chunker.ts`

```typescript
export interface Chunk {
  text: string;
  startOffset: number;
  endOffset: number;
}
```

### 5.2 `chunkText()` — `packages/workers/src/vector/chunker.ts`

```typescript
export function chunkText(
  content: string,
  size?: number,    // default 800
  overlap?: number  // default 200
): Chunk[]
```

Constraints:
- Pure function — no I/O, no side-effects, no imports.
- Step size = `size - overlap`. Advance window by step each iteration.
- Last chunk always terminates at `content.length` regardless of remainder size.
- Empty string → `[]`.

### 5.3 `OllamaClient.embed()` — `packages/backend/src/ollama/client.ts`

The existing single-text overload is replaced with the batch signature from the spec:

```typescript
async embed(model: string, inputs: string[]): Promise<number[][]>
```

- Calls `POST ${this.baseUrl}/api/embed` with body `{ model, input: inputs }`.
- Parses response as `{ embeddings: number[][] }`.
- Throws `Error` with status + body if `!res.ok`.
- Returns `embeddings` directly (same length as `inputs`).

> **Note**: The existing single-argument convenience call `embed(text, model?)` in the current file will be **removed** and replaced by this batch signature. Any internal callers (none at time of writing) must be updated.

### 5.4 `embedChunks()` — `packages/workers/src/vector/embedder.ts`

```typescript
import type { OllamaClient } from '../../backend/src/ollama/client.js'; // workspace import

export async function embedChunks(
  chunks: string[],
  client: OllamaClient,
  model: string       // default caller responsibility; spec implies "nomic-embed-text"
): Promise<number[][]>
```

- Batches `chunks` into groups of ≤ 32.
- Calls `client.embed(model, batch)` per group.
- Concatenates results preserving order.
- Emits Pino `debug` per batch: `{ event: "embed_batch", batchIndex, batchSize, model }`.
- Empty input → returns `[]` immediately.

### 5.5 `VectorIndexStore` — `packages/workers/src/vector/index-store.ts`

```typescript
import type { Chunk } from './chunker.js';

export interface FileHashRow {
  file_path: string;
  file_hash: string;
}

export class VectorIndexStore {
  constructor(dbPath: string) // dbPath = VECTOR_DB_PATH

  /** Initialise HNSW index and SQLite DB. Must be called before any other method. */
  init(): void

  /** Returns current file_path → file_hash mapping for all indexed files. */
  getFileHashes(): Map<string, string>

  /**
   * Insert chunks + embeddings for a file. Wraps all SQLite writes in a transaction.
   * Throws if chunks.length !== embeddings.length.
   */
  addChunks(
    filePath: string,
    fileHash: string,
    chunks: Chunk[],
    embeddings: number[][]
  ): void

  /**
   * Mark-delete all HNSW labels for filePath; delete rows from SQLite.
   * After deletion, checks rebuild threshold (>20% deleted → full rebuild).
   */
  deleteChunksByFile(filePath: string): void

  /**
   * kNN search. Returns at most topK results sorted by ascending cosine distance.
   * Returns [] if index is empty.
   */
  searchKnn(
    queryEmbedding: number[],
    topK: number
  ): Array<{ hnswId: number; distance: number }>

  /** Total elements currently in the HNSW index (includes marked-deleted). */
  getCurrentCount(): number

  /** Count of marked-deleted elements. Derived from getCurrentCount() minus live rows. */
  getDeletedCount(): number
}
```

**Rebuild logic** (inside `deleteChunksByFile`):

```
deletedRatio = getDeletedCount() / getCurrentCount()
if deletedRatio > 0.20:
  rows = SELECT id, file_path, file_hash, start_offset, end_offset, text, hnsw_id FROM chunks
  embeddings = embedChunks(rows.map(r => r.text), ...)
  build fresh HierarchicalNSW with same params
  for each (row, emb): index.addPoint(emb, row.hnsw_id)
  index.writeIndex(path)
  this.index = freshIndex
  logger.info({ event: "hnsw_rebuild", chunkCount: rows.length })
```

### 5.6 `vector_search` tool — `packages/backend/src/tools/impl/vector-search.ts`

```typescript
import { z } from 'zod';
import type { ToolDef, ToolContext } from '../types.js';

export interface VectorSearchResult {
  file: string;
  startOffset: number;
  endOffset: number;
  text: string;
  score: number; // 1 - cosine_distance
}

const inputSchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().min(1).max(20).optional().default(5),
});

export const vectorSearchTool: ToolDef = {
  name: 'vector_search',
  description:
    'Semantic search over the indexed codebase. Returns the most relevant code chunks for a natural-language query.',
  parameters: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', description: 'Natural language description of what to find' },
      topK: { type: 'number', description: 'Number of results to return (1–20, default 5)' },
    },
  },
  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<string>,
};
```

`execute` implementation sketch (not a full implementation — see task list):
1. Parse `args` through `inputSchema.parse(args)`.
2. Guard: if `VECTOR_DB_PATH` not set → return `JSON.stringify({ error: "Vector index unavailable: VECTOR_DB_PATH not configured" })`.
3. `client.embed("nomic-embed-text", [query])` → catch → return embed error JSON.
4. `store.searchKnn(embedding[0], topK)` → `[]` if store not initialised.
5. Bulk `SELECT` from `chunks.db` by `hnsw_id` list.
6. Map to `VectorSearchResult[]` with `score = 1 - distance`, sort descending.
7. Return `JSON.stringify(results)`.

---

## 6. Data Model

### `$VECTOR_DB_PATH/chunks.db`

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS chunks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path    TEXT    NOT NULL,
  file_hash    TEXT    NOT NULL,     -- sha256 hex of the file at indexing time
  start_offset INTEGER NOT NULL,
  end_offset   INTEGER NOT NULL,
  text         TEXT    NOT NULL,
  hnsw_id      INTEGER NOT NULL UNIQUE  -- 1-to-1 with HNSW label
);

CREATE INDEX IF NOT EXISTS idx_chunks_file_path ON chunks(file_path);
CREATE INDEX IF NOT EXISTS idx_chunks_file_hash ON chunks(file_hash);
CREATE INDEX IF NOT EXISTS idx_chunks_hnsw_id   ON chunks(hnsw_id);
```

**Notes**:
- No `files` table. The per-file hash is denormalised into every chunk row. This avoids a two-table join on the hot incremental path and is acceptable given each file typically produces 2–20 chunks.
- `hnsw_id` is assigned by `VectorIndexStore` as a monotonically increasing counter (persist `nextLabel` in memory; reset from `MAX(hnsw_id)` on load).
- `start_offset` / `end_offset` are byte offsets into the original file content string — matches the `Chunk` type exactly.
- `UNIQUE` on `hnsw_id` ensures referential integrity without a foreign key to an external table.

### `$VECTOR_DB_PATH/index.hnsw`

Binary file managed entirely by `hnswlib-node`. Parameters:

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `space` | `'cosine'` | Standard for text embeddings |
| `dim` | `768` | `nomic-embed-text` output dimension |
| `maxElements` | `100_000` | Upper bound for typical monorepo; HNSW supports resize but avoiding it keeps latency flat |
| `M` | `16` (hnswlib default) | Good recall/speed tradeoff |
| `efConstruction` | `200` (hnswlib default) | Index quality vs build speed |

---

## 7. Configuration

All configuration flows through the existing `packages/backend/src/config.ts` Zod schema (already declared) and equivalent process.env reads in workers (workers do not currently have a config.ts — env vars are read directly).

### Environment variables

| Variable | Default | Used by | Description |
|----------|---------|---------|-------------|
| `VECTOR_DB_PATH` | `./data/vectors` | workers + backend | Directory for `index.hnsw` and `chunks.db`. MUST be writable by workers, readable by backend. |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | workers + backend | Ollama server base URL |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | workers + backend | Model used for embedding. Changing this invalidates the existing index (requires full rebuild). |

### Configuration guards

**Workers sidecar** (`packages/workers/src/index.ts`):
```typescript
const vectorDbPath = process.env['VECTOR_DB_PATH'];
if (!vectorDbPath) {
  logger.error({ event: 'config_error' }, 'VECTOR_DB_PATH not configured — vector indexing disabled');
  // store remains undefined; indexCodebase handler checks and fails fast
}
```

**Backend `vector_search` tool**:
- Reads `process.env['VECTOR_DB_PATH']` at execute-time (not at module load) so the process does not crash if the env var is absent.
- Returns a structured error result; the agent continues.

### Infisical secret provisioning

`VECTOR_DB_PATH` is an infrastructure path (not a secret), but should be added to the `devmind-workers` Infisical environment alongside `OLLAMA_BASE_URL`. No secrets (passwords, tokens) are introduced by this change.

---

## 8. Error Handling Summary

| Scenario | Handler | Outcome |
|----------|---------|---------|
| `VECTOR_DB_PATH` unset at workers start | `index.ts` guard | Pino `error`; store not init; process continues |
| `VECTOR_DB_PATH` unset at query time | `vector_search` execute guard | Returns `{ error: "…not configured" }`; no crash |
| `index.hnsw` corrupt on load | `VectorIndexStore.init()` try/catch | Pino `warn`; fresh empty index; `chunks.db` cleared |
| `client.embed()` throws during indexing | `indexCodebase` try/catch per file | Pino `error`; file skipped; job continues |
| `client.embed()` throws during search | `vector_search` try/catch | Returns `{ error: "Embedding failed: …" }` |
| File read error during indexing | `indexCodebase` try/catch per file | Pino `error`; file skipped; job completes `done` |
| `chunks.length !== embeddings.length` in `addChunks` | `VectorIndexStore` guard | `Error` thrown; transaction rolled back |
| Deleted chunks > 20% of total | `deleteChunksByFile` threshold check | Full in-memory rebuild; atomic file replace |
| HNSW `searchKnn` on empty index | `VectorIndexStore.searchKnn()` guard | Returns `[]` without calling hnswlib |

---

## 9. Implementation Order (suggested task sequence)

1. **`chunker.ts`** — pure function, no deps, easiest to test first
2. **`OllamaClient.embed()` update** — update signature; fix the existing single-string overload
3. **`embedder.ts`** — depends on updated `OllamaClient`
4. **`index-store.ts`** — depends on `chunker.ts` + `embedder.ts` (for rebuild path)
5. **`index-codebase.ts` replacement** — wires chunker + embedder + store together
6. **`vector-search.ts` tool** — backend query path; depends on store's `searchKnn`
7. **`tools/index.ts` registration** — one-liner addition after tool is written
8. **Workers `index.ts` guard** — add `VECTOR_DB_PATH` check at startup

`pnpm -r build` MUST pass after each step.
