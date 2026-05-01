# Tasks: 002-fase-6-vector-search

> **Status**: ready  
> **Change ID**: 002-fase-6-vector-search  
> **Date**: 2025-07-17  
> **Author**: sdd-tasks subagent

---

## Design correction (authoritative)

The design.md describes `OllamaClient` being imported from `packages/backend` into workers via a workspace dependency. **This is overridden here.** Workers are self-contained:

- `packages/workers/src/vector/embed-client.ts` — a thin `fetch`-only HTTP client for `POST OLLAMA_BASE_URL/api/embed`, batches ≤ 32 texts  
- `packages/backend/src/ollama/client.ts` — receives `embed(model, texts): Promise<number[][]>` independently (the current single-text `embed()` is replaced with a batched version)  
- No cross-package imports between `workers` and `backend`

---

## Phase 1 — workers: foundation modules

---

### T01 — Chunk text into sliding windows

**File**: `packages/workers/src/vector/chunker.ts`  
**Depends on**: —

**Description**  
Implement `chunkText(text: string, filePath: string): Chunk[]` that splits a source file into overlapping chunks using an 800-char window with 200-char overlap (stride = 600). A chunk covers `[startOffset, endOffset)` in the original `text`. `hash` is `sha256hex(filePath + ':' + startOffset)`.

```typescript
export type Chunk = {
  text: string;
  filePath: string;
  startOffset: number;
  endOffset: number;
  hash: string; // sha256 of filePath + ':' + startOffset
};

export function chunkText(text: string, filePath: string): Chunk[]
```

Implementation notes:
- Window = 800 chars, stride = 600 chars (200-char overlap between consecutive chunks)
- Last chunk may be shorter than 800 chars — always include it if `text.length > 0`
- Empty or whitespace-only `text` → return `[]`
- Hash: `createHash('sha256').update(filePath + ':' + startOffset).digest('hex')` (node:crypto)
- All imports must use `.js` extension (NodeNext resolution)

**Acceptance criteria**
- `chunkText('', 'x.ts')` returns `[]`
- A 1500-char string produces 3 chunks with offsets `[0,800)`, `[600,1400)`, `[900,1500)`  
  *(stride 600: starts at 0, 600, 1200 — last window clamped to text end)*
- Each chunk's `hash` is a 64-char hex string
- `import type` used for type-only imports; no `any`

---

### T02 — Embed client (thin HTTP, workers-only)

**File**: `packages/workers/src/vector/embed-client.ts`  
**Depends on**: —

**Description**  
Implement a thin `fetch`-only HTTP client that calls `POST {OLLAMA_BASE_URL}/api/embed` and returns `number[][]`. No `OllamaClient` from backend — this module is the workers' own embedding primitive.

```typescript
// POST body: { model: string, input: string[] }
// Response: { embeddings: number[][] }

export type EmbedClientOptions = {
  baseUrl: string;
  model: string;
  batchSize?: number; // default 32
};

export async function embedTexts(
  texts: string[],
  opts: EmbedClientOptions
): Promise<number[][]>
```

Implementation notes:
- Split `texts` into batches of `opts.batchSize ?? 32`
- Issue batches sequentially (not concurrently) to avoid Ollama OOM
- On HTTP error: throw `Error(`Ollama embed error ${status}: ${body}`)` — caller decides to skip
- Return value preserves input order (concat batch results)
- Zero texts → return `[]`
- `exactOptionalPropertyTypes`: declare `batchSize?: number` properly

**Acceptance criteria**
- Correct sequential batching: 70 texts with batchSize 32 → 3 fetch calls (32 + 32 + 6)
- HTTP 500 from Ollama → throws with status in message
- Empty input → returns `[]` without calling fetch
- TypeScript strict: no `any`, no `as unknown`

---

### T03 — VectorIndexStore: SQLite + HNSW persistence

**File**: `packages/workers/src/vector/index-store.ts`  
**Depends on**: T01 (uses `Chunk` type)

**Description**  
Implement `VectorIndexStore` — the single owner of the HNSW index and `chunks.db` SQLite database in the workers process. All HNSW operations live here; no other module imports `hnswlib-node`.

```typescript
import type { Chunk } from './chunker.js';

export type StoredChunkRow = {
  id: number;
  filePath: string;
  fileHash: string;
  chunkHash: string;
  startOffset: number;
  endOffset: number;
  text: string;
  hnswLabel: number;
};

export class VectorIndexStore {
  constructor(dbPath: string, hnswPath: string) {}

  /** Must be called before any other method. Creates schema, loads or creates HNSW index. */
  async init(): Promise<void>

  getFileHashes(): Map<string, string> // filePath → fileHash

  deleteChunksByFile(filePath: string): void

  /** Insert chunks + embeddings atomically. Assigns sequential hnswLabel values. */
  addChunks(chunks: Chunk[], embeddings: number[][], fileHash: string): void

  /** Return all hnsw_labels present in the index (for detecting orphan files). */
  getAllFilePaths(): Set<string>

  /** kNN search. Returns up to k results with cosine similarity score. */
  searchKnn(
    queryEmbedding: number[],
    k: number
  ): Array<{ hnswLabel: number; score: number }>

  /** Persist HNSW index to disk. */
  saveIndex(): void

  /** Full rebuild: drop all chunks, recreate HNSW index from scratch. */
  rebuildIndex(allChunks: Chunk[], allEmbeddings: number[][], fileHashes: Map<string, string>): void
}
```

**chunks.db schema** (create on `init()` if not exists):
```sql
CREATE TABLE IF NOT EXISTS chunks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path    TEXT    NOT NULL,
  file_hash    TEXT    NOT NULL,
  chunk_hash   TEXT    NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset   INTEGER NOT NULL,
  text         TEXT    NOT NULL,
  hnsw_label   INTEGER NOT NULL UNIQUE,
  indexed_at   INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_chunks_file_path  ON chunks(file_path);
CREATE INDEX IF NOT EXISTS idx_chunks_hnsw_label ON chunks(hnsw_label);
```

**HNSW parameters**: `space: 'cosine'`, `numDimensions: 768`, `maxElements: 100_000`

**Error handling**:
- On `init()`: if HNSW file is corrupt/unreadable → log warning, delete both `.hnsw` and `.db` files, recreate from scratch
- `VECTOR_DB_PATH` not set → throw `Error('VECTOR_DB_PATH is not set')` in the constructor or init

**Acceptance criteria**
- `init()` is idempotent: calling twice does not duplicate schema or reset data
- `addChunks` is atomic: if HNSW `addPoint` throws, SQLite transaction is rolled back
- `deleteChunksByFile` calls `index.markDelete(hnswLabel)` for each deleted row
- `saveIndex()` writes to `hnswPath`
- After `rebuildIndex`, `getFileHashes()` reflects the new data
- `hnswlib-node` imported only in this file (never re-exported)

---

## Phase 2 — workers: handler integration

---

### T04 — Wire indexCodebase handler with real implementation

**File**: `packages/workers/src/handlers/index-codebase.ts`  
**Depends on**: T01, T02, T03

**Description**  
Replace the stub implementation with the real incremental indexing pipeline. The handler already has `collectFiles()`; extend it to:

1. Read `VECTOR_DB_PATH` from `process.env` — throw if unset  
2. Instantiate `VectorIndexStore(dbPath + '/chunks.db', dbPath + '/index.hnsw')`, call `await store.init()`  
3. Collect `.ts/.tsx/.js/.jsx` files from `payload.repoPath` (existing logic)  
4. `store.getFileHashes()` → compare `sha256(fileContent)` per file  
5. Skip files whose hash matches stored hash  
6. `store.deleteChunksByFile(filePath)` for changed files  
7. For changed/new files: `chunkText(content, filePath)` → `embedTexts(texts, opts)` → `store.addChunks(chunks, embeddings, fileHash)`  
   - If `embedTexts` throws for a file's batch → `logger.warn` + skip (partial index is acceptable)  
8. Delete chunks for files no longer present in repo: `store.deleteChunksByFile(missingFilePath)`  
9. If `deletedCount / totalChunkCount > 0.2` → call `store.rebuildIndex(...)` (full reload prevents HNSW fragmentation)  
10. `store.saveIndex()`  
11. `jobs.updateStatus(jobId, 'done')` — keep existing status update at the end

**Logger**: use `pino` — import from the workers package logger (or instantiate with `import pino from 'pino'` if no shared logger exists). Use `logger.info` for progress, `logger.warn` for skipped batches.

**OLLAMA_BASE_URL**: read from `process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'`  
**OLLAMA_EMBED_MODEL**: read from `process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text'`

**Acceptance criteria**
- Missing `VECTOR_DB_PATH` → job fails with a thrown Error (not silent)
- Unchanged files (same sha256) are not re-embedded (zero embed calls for them)
- A file deleted from disk has its chunks removed from store
- `store.saveIndex()` is called before `jobs.updateStatus`
- `embedTexts` failure for one file does not abort the entire job
- No cross-package imports from `packages/backend`

---

## Phase 3 — backend: query-time additions

---

### T05 — Upgrade OllamaClient.embed to batched multi-text

**File**: `packages/backend/src/ollama/client.ts`  
**Depends on**: —

**Description**  
The current `embed(text, model)` takes a single string and returns `number[]`. Replace it with a batched signature that takes `string[]` and returns `number[][]`, consistent with how the vector-search tool will use it.

```typescript
// OLD (remove):
async embed(text: string, model = config.OLLAMA_EMBED_MODEL): Promise<number[]>

// NEW:
async embed(model: string, texts: string[]): Promise<number[][]>
```

Implementation: `POST /api/embed` with `{ model, input: texts }`, response `{ embeddings: number[][] }`. Throw on HTTP error (same pattern as existing methods).

**Breaking change**: the old single-string overload is gone. Scan the codebase for any existing callers of `embed()` in backend and update them. (Currently there are none in production code — verify with grep.)

**Acceptance criteria**
- New signature compiles under strict TypeScript
- `pnpm -r build` passes
- Old single-string signature is fully removed
- `OllamaEmbedResponse` interface is updated to match `{ embeddings: number[][] }`

---

### T06 — Implement vector_search tool

**File**: `packages/backend/src/tools/impl/vector-search.ts`  
**Depends on**: T03 (shares `chunks.db` schema), T05

**Description**  
Implement the `vector_search` agent tool. It opens `chunks.db` **read-only** and loads the HNSW index **read-only**. It must never write to either file — the workers process owns writes.

```typescript
import type { ToolDef } from '../types.js';

export type VectorSearchResult = {
  filePath: string;
  startOffset: number;
  endOffset: number;
  text: string;
  score: number; // 1 - cosineDistance, range [0, 1]
};

export const vectorSearchTool: ToolDef
```

**Zod input schema**:
```typescript
const VectorSearchInput = z.object({
  query: z.string().min(1).max(2000),
  topK: z.number().int().min(1).max(20).default(5),
});
```

**Execution flow**:
1. Read `VECTOR_DB_PATH` from `process.env` — if unset, return `{ error: 'VECTOR_DB_PATH not configured' }`
2. Lazy-init: on first call, open `chunks.db` read-only (`better-sqlite3` with `{ readonly: true }`) and load HNSW index read-only (`HierarchicalNSW.readIndex(path)`)
3. `ollamaClient.embed(model, [query])` → `queryEmbedding: number[]`
4. `hnsw.searchKnn(queryEmbedding, topK)` → `{ neighbors, distances }`
5. `SELECT * FROM chunks WHERE hnsw_label IN (...)` (SQLite `IN` clause)
6. Map to `VectorSearchResult[]` sorted by `score desc`, where `score = 1 - distance`
7. Return results as JSON

**Isolation**: `hnswlib-node` is imported **read-only** in backend solely for kNN queries. Workers own all writes; backend never calls `addPoint`, `markDelete`, or `saveIndex`. This matches the design.md: "backend opens the HNSW file read-only". Workers is a pure polling process with no HTTP server — inter-process HTTP would add unnecessary complexity.

**hnswlib-node in backend**: add `hnswlib-node@^3.0.0` to `packages/backend/package.json` dependencies. Load the index with `HierarchicalNSW.readIndex(path, maxElements)` in read-only mode. Do NOT call any mutation methods.

**Acceptance criteria**
- No `hnswlib-node` import in any `packages/backend` file
- `VECTOR_DB_PATH` unset → graceful error response, no throw
- Results sorted by score descending
- `topK` respected (never returns more than `topK` results)
- Zod validation rejects `query: ''` and `topK: 0`

---

### T07 — Register vector_search in tool registry

**File**: `packages/backend/src/tools/index.ts`  
**Depends on**: T06

**Description**  
Import `vectorSearchTool` from `./impl/vector-search.js` and register it in `createToolRegistry`. The tool does not require any `ToolServices` — it reads from disk directly — so it can be added to the `.register(...)` call unconditionally.

```typescript
import { vectorSearchTool } from './impl/vector-search.js';
// ...
return new ToolRegistry().register(
  // ... existing tools ...
  vectorSearchTool,
);
```

**Acceptance criteria**
- `pnpm -r build` passes
- The tool name `vector_search` is visible in the registry
- No other files in `packages/backend/src/tools/` are modified

---

## Phase 4 — verification

---

### T08 — Full build verification

**Depends on**: T01, T02, T03, T04, T05, T06, T07

**Description**  
Run the full monorepo build to confirm all TypeScript compiles cleanly across both packages.

```bash
pnpm -r build
```

Expected: zero TypeScript errors, zero missing module errors. If any errors surface, fix them before marking this task done.

**Acceptance criteria**
- `pnpm -r build` exits with code 0
- No `any` type errors suppressed with `@ts-ignore` or `@ts-expect-error`
- No circular import warnings
- Both `packages/workers` and `packages/backend` build artifacts are emitted

---

## Task summary table

| ID  | Title                                       | Phase   | File(s)                                                    | Depends on       |
|-----|---------------------------------------------|---------|------------------------------------------------------------|------------------|
| T01 | Chunk text into sliding windows             | workers | `workers/src/vector/chunker.ts`                            | —                |
| T02 | Embed client (thin HTTP, workers-only)      | workers | `workers/src/vector/embed-client.ts`                       | —                |
| T03 | VectorIndexStore: SQLite + HNSW persistence | workers | `workers/src/vector/index-store.ts`                        | T01              |
| T04 | Wire indexCodebase with real implementation | workers | `workers/src/handlers/index-codebase.ts`                   | T01, T02, T03    |
| T05 | Upgrade OllamaClient.embed to batched       | backend | `backend/src/ollama/client.ts`                             | —                |
| T06 | Implement vector_search tool                | backend | `backend/src/tools/impl/vector-search.ts` + workers http  | T03, T05         |
| T07 | Register vector_search in tool registry     | backend | `backend/src/tools/index.ts`                               | T06              |
| T08 | Full build verification                     | verify  | —                                                          | T01–T07          |

---

## Implementation order

```
T01 ──┬── T03 ── T04
T02 ──┘

T05 ──── T06 ── T07

T01–T07 ── T08
```

T01, T02, T05 can be implemented in parallel (no dependencies between them).  
T03 requires T01 (uses `Chunk` type).  
T04 requires T01+T02+T03.  
T06 requires T03 (shared schema knowledge) and T05 (embed signature).  
T07 requires T06.  
T08 is the final gate.
