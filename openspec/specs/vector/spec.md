# Delta Spec: 002-fase-6-vector-search

> **Status**: approved  
> **Change ID**: 002-fase-6-vector-search  
> **Date**: 2025-07-17

All capabilities in this change are new (`### ADDED`). No existing behaviour is removed or altered except the stub body of `index-codebase.ts`.

---

## ### ADDED — Chunking

**Package**: `packages/workers/src/vector/chunker.ts`

### Requirement: Char-Based Sliding Window Chunker

`chunker.ts` MUST export a pure function `chunkText(content: string, size?: number, overlap?: number): Chunk[]`. Default `size` SHALL be `800` characters; default `overlap` SHALL be `200` characters. The `Chunk` type MUST be:

```ts
export interface Chunk {
  text: string;
  startOffset: number;
  endOffset: number;
}
```

The type MUST be defined in `packages/workers/src/vector/chunker.ts` and imported from there within the workers package. It MUST NOT be placed in a shared package.

The function MUST produce chunks by advancing a window of `size` characters, stepping forward by `size - overlap` on each iteration. The last chunk MUST include all remaining content regardless of length. Each chunk's `startOffset` and `endOffset` MUST exactly reflect the byte offsets within the original `content` string.

The function MUST be a pure function with no side effects, no I/O, and no external dependencies.

#### Scenario: Standard chunking of a long file

- GIVEN `content` is a 2000-character string, `size=800`, `overlap=200`
- WHEN `chunkText(content, 800, 200)` is called
- THEN the result contains 4 chunks; chunk boundaries are contiguous; `chunks[0].startOffset === 0`; `chunks[0].endOffset === 800`; each successive chunk overlaps the previous by 200 characters; the final chunk's `endOffset === 2000`

#### Scenario: Short content fits in a single chunk

- GIVEN `content` is 400 characters, `size=800`
- WHEN `chunkText(content, 800, 200)` is called
- THEN the result contains exactly 1 chunk with `startOffset=0` and `endOffset=400`

#### Scenario: Empty string

- GIVEN `content` is an empty string
- WHEN `chunkText` is called
- THEN the result is an empty array

---

## ### ADDED — Embedding

**Package**: `packages/workers/src/vector/embedder.ts` · `packages/backend/src/ollama/client.ts`

### Requirement: OllamaClient.embed() Method

`packages/backend/src/ollama/client.ts` MUST add a method with the following signature:

```ts
async embed(model: string, inputs: string[]): Promise<number[][]>
```

The method SHALL call `POST /api/embed` on `this.baseUrl` with body `{ model, input: inputs }`. The response MUST be parsed as `{ embeddings: number[][] }`. The method MUST return `embeddings` directly. If the HTTP response is not `ok`, the method MUST throw an `Error` containing the status code and response body.

#### Scenario: Successful batch embed

- GIVEN the Ollama service is reachable and `inputs` is a non-empty string array
- WHEN `client.embed("nomic-embed-text", inputs)` is called
- THEN `embeddings` is returned as a `number[][]` with the same length as `inputs`

#### Scenario: Ollama unreachable

- GIVEN the Ollama service is down
- WHEN `client.embed()` is called
- THEN the method throws an `Error` (the caller, `embedder.ts`, MUST catch and log this)

---

### Requirement: Batched File Embedding in embedder.ts

`packages/workers/src/vector/embedder.ts` MUST export a function:

```ts
export async function embedChunks(
  chunks: string[],
  client: OllamaClient,
  model: string
): Promise<number[][]>
```

The function MUST batch `chunks` into groups of at most **32** per request and call `client.embed(model, batch)` for each group. It MUST concatenate the resulting embedding arrays in order. The model MUST default to `"nomic-embed-text"` if not specified by the caller.

The function MUST use Pino structured logging to emit a `debug` log entry per batch with fields `{ batchIndex, batchSize, model }`.

#### Scenario: Batch boundary respected

- GIVEN 65 chunks are passed to `embedChunks`
- WHEN the function runs
- THEN exactly 3 calls are made to `client.embed`: two with 32 items and one with 1 item

#### Scenario: Empty chunk list

- GIVEN `chunks` is empty
- WHEN `embedChunks` is called
- THEN an empty array is returned and no HTTP calls are made

---

## ### ADDED — Index Persistence

**Package**: `packages/workers/src/vector/index-store.ts`

### Requirement: Dual-Store Architecture (HNSW + SQLite)

`index-store.ts` MUST manage two co-located stores at paths derived from the `VECTOR_DB_PATH` environment variable:

| Store | Path | Purpose |
|-------|------|---------|
| HNSW binary | `$VECTOR_DB_PATH/index.hnsw` | kNN vector search via `hnswlib-node` |
| SQLite DB | `$VECTOR_DB_PATH/chunks.db` | Chunk metadata + file hashes |

The `VectorIndexStore` class (or equivalent exported initializer) MUST create `VECTOR_DB_PATH` if it does not exist. Both stores MUST be initialised before any read or write operation is attempted.

### Requirement: chunks.db Schema

`chunks.db` MUST have WAL mode enabled. The following table MUST exist:

```sql
CREATE TABLE IF NOT EXISTS chunks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path   TEXT    NOT NULL,
  file_hash   TEXT    NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset   INTEGER NOT NULL,
  text        TEXT    NOT NULL,
  hnsw_id     INTEGER NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_chunks_file_path ON chunks(file_path);
CREATE INDEX IF NOT EXISTS idx_chunks_file_hash ON chunks(file_hash);
```

`hnsw_id` MUST be the integer label used in the HNSW index and MUST be 1-to-1 with each chunk row. No foreign keys to the main app DB are needed.

### Requirement: HNSW Index Initialisation

The HNSW index MUST be created with `space = 'cosine'` and `dim` matching the embedding dimension of the configured model (`768` for `nomic-embed-text`). The `maxElements` SHOULD be set to a sufficiently large value (at minimum `100_000`) to avoid runtime resize. If `index.hnsw` already exists on disk, it MUST be loaded rather than re-created.

#### Scenario: Fresh initialisation

- GIVEN `VECTOR_DB_PATH` points to an empty directory
- WHEN the store is initialised
- THEN `index.hnsw` and `chunks.db` are created; no error is thrown

#### Scenario: Reload on restart

- GIVEN `index.hnsw` and `chunks.db` already exist with data
- WHEN the store is reinitialised (e.g. worker restart)
- THEN the existing index is loaded; existing chunk rows are accessible; no data is lost

---

### Requirement: addChunks()

The store MUST expose:

```ts
addChunks(filePath: string, fileHash: string, chunks: Chunk[], embeddings: number[][]): void
```

`chunks` and `embeddings` MUST have the same length; if they differ, an `Error` MUST be thrown before any writes. For each pair `(chunk, embedding)`, the function MUST: assign the next available HNSW integer label, call `index.addPoint(embedding, label)`, and insert a row into `chunks`. All SQLite inserts for a single `addChunks` call MUST be wrapped in a single transaction.

#### Scenario: Successful add

- GIVEN a file with 5 chunks and 5 corresponding embeddings
- WHEN `addChunks` is called
- THEN 5 rows are present in `chunks`; `index.getCurrentCount()` increases by 5; each row's `hnsw_id` is unique

---

### Requirement: deleteChunksByFile()

The store MUST expose:

```ts
deleteChunksByFile(filePath: string): void
```

The function MUST call `index.markDelete(hnsw_id)` for every chunk row with the given `file_path`, then delete those rows from SQLite. Both operations MUST succeed or both MUST be rolled back (wrap in a SQLite transaction, call `markDelete` inside the same block, catching any HNSW errors to trigger rollback).

---

### Requirement: HNSW Rebuild Threshold

After each `deleteChunksByFile` call, the store MUST check whether the number of marked-deleted entries in the HNSW index exceeds **20%** of total elements (`getCurrentCount()`). If the threshold is exceeded, the store MUST trigger a full index rebuild:

1. Load all `(hnsw_id, text)` rows from `chunks.db` — these are the surviving chunks.
2. Re-embed all surviving chunks using `embedChunks()`.
3. Create a fresh HNSW index in memory with the same parameters.
4. Add all surviving embeddings with their original `hnsw_id` labels.
5. Save the new index to `$VECTOR_DB_PATH/index.hnsw`, atomically replacing the old file.
6. Log a `info` Pino entry `{ event: "hnsw_rebuild", chunkCount }`.

#### Scenario: Rebuild triggered at 21% deleted

- GIVEN an index with 100 elements and 20 marked-deleted
- WHEN `deleteChunksByFile` removes one more chunk (21 total deleted)
- THEN a full rebuild is initiated and the rebuilt index contains only the 79 surviving chunks

#### Scenario: No rebuild below threshold

- GIVEN an index with 100 elements and 15 marked-deleted (15%)
- WHEN `deleteChunksByFile` is called
- THEN no rebuild occurs and `getCurrentCount()` reflects the deletion via `markDelete` only

---

## ### ADDED — Incremental Reindex

**Package**: `packages/workers/src/handlers/index-codebase.ts`

### Requirement: Replace Stub with Real Implementation

The existing stub body in `index-codebase.ts` MUST be replaced. The handler MUST implement the following algorithm:

1. Collect all target files under `payload.repoPath` (extensions: `.ts`, `.tsx`, `.js`, `.jsx`), excluding `node_modules` and hidden directories.
2. For each file, compute a `sha256` hex digest of its contents.
3. Look up the hash in `chunks.db` for that `file_path`.
4. **Skip** the file if the stored `file_hash` matches the computed hash (no change).
5. For changed or new files: call `deleteChunksByFile(filePath)` (no-op for new files), chunk the file content, embed all chunks in batches of 32, call `addChunks`.
6. For deleted files (present in `chunks.db` but absent from the filesystem scan): call `deleteChunksByFile(filePath)`.
7. Update the job row payload with `{ chunkCount, filesIndexed, filesSkipped }` via `db.prepare(...).run(...)` on completion.

The handler MUST use Pino structured logging with `{ event, filePath, fileHash, chunkCount }` fields on each index/skip/delete action. The handler MUST NOT throw on individual file read failures; it SHALL log the error and continue with remaining files.

#### Scenario: Unchanged file skipped

- GIVEN a file is already indexed with the current hash in `chunks.db`
- WHEN `index-codebase` runs over the same `repoPath`
- THEN the file's chunks are not re-embedded; no calls to `client.embed` are made for that file

#### Scenario: Modified file re-indexed

- GIVEN a file's content changes between two runs
- WHEN `index-codebase` runs
- THEN old chunks for the file are deleted, new chunks are embedded and stored, and `file_hash` is updated

#### Scenario: Deleted file cleaned up

- GIVEN a file exists in `chunks.db` but no longer exists on the filesystem
- WHEN `index-codebase` runs
- THEN `deleteChunksByFile` is called for that path and its chunks are removed from both stores

#### Scenario: Unreadable file does not abort job

- GIVEN one file in the scan target throws `EACCES` on read
- WHEN the handler processes the directory
- THEN the error is logged and remaining files continue to be processed; the job completes with `status=done`

---

## ### ADDED — vector_search Tool

**Package**: `packages/backend/src/tools/impl/vector-search.ts` · `packages/backend/src/tools/index.ts`

### Requirement: vector_search Tool Implementation

`packages/backend/src/tools/impl/vector-search.ts` MUST export a LangGraph-compatible tool created with `@langchain/core/tools`. The tool MUST be named `"vector_search"`.

The `VectorSearchResult` type MUST be defined in `packages/backend/src/tools/impl/vector-search.ts`:

```ts
export interface VectorSearchResult {
  file: string;
  startOffset: number;
  endOffset: number;
  text: string;
  score: number;
}
```

Input schema MUST be validated with Zod:

```ts
const inputSchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().min(1).max(20).optional().default(5),
});
```

The tool MUST NOT accept `any` or unvalidated input. TypeScript strict mode (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`) MUST be satisfied. All imports MUST use `.js` extensions (NodeNext resolution).

### Requirement: vector_search Execution Flow

When invoked, the tool MUST:

1. Validate input with the Zod schema.
2. Call `client.embed("nomic-embed-text", [query])` to obtain a single query embedding.
3. Call `index.searchKnn(queryEmbedding, topK)` on the loaded HNSW index.
4. For each result label returned by HNSW, look up the corresponding row in `chunks.db` by `hnsw_id`.
5. Return a JSON-serialised `VectorSearchResult[]` sorted by `score` descending (lower cosine distance = higher relevance).

The `score` field in each result MUST be `1 - distance` where `distance` is the cosine distance returned by HNSW (`searchKnn` returns `{ neighbors, distances }`).

#### Scenario: Successful semantic search

- GIVEN the HNSW index contains indexed chunks for a codebase
- WHEN the agent calls `vector_search({ query: "authentication middleware", topK: 3 })`
- THEN the tool returns a `VectorSearchResult[]` of length ≤ 3 with non-empty `text`, valid `file` paths, and `score` between 0 and 1

#### Scenario: Empty index returns empty results

- GIVEN the HNSW index has no elements
- WHEN `vector_search` is called
- THEN the tool returns `[]` without error

#### Scenario: topK defaults to 5

- GIVEN the agent calls `vector_search({ query: "routing" })` without `topK`
- WHEN the tool runs
- THEN at most 5 results are returned

#### Scenario: Invalid input rejected

- GIVEN `query` is an empty string
- WHEN the tool validates input
- THEN Zod throws a `ZodError` and the tool returns a structured error result; no embedding call is made

---

### Requirement: Tool Registration

`packages/backend/src/tools/index.ts` MUST import and register `vector_search` alongside the existing tools. The tool MUST be included in the array/object exported as the tool registry used by the LangGraph agent.

#### Scenario: Tool available to agent

- GIVEN the backend starts with `VECTOR_DB_PATH` set
- WHEN the agent's tool registry is initialised
- THEN `vector_search` is present in the list of available tools

---

## ### ADDED — Error Handling

### Requirement: VECTOR_DB_PATH Configuration Guard

If `VECTOR_DB_PATH` is not set or is an empty string at worker startup, the workers sidecar MUST log a Pino `error` entry and MUST NOT attempt to initialise the vector store. Any `index-codebase` job dispatched while the vector store is unavailable MUST fail with `status=failed` and an `error` message of `"VECTOR_DB_PATH not configured"`.

If `VECTOR_DB_PATH` is not set at backend startup, the `vector_search` tool MUST return an error result with message `"Vector index unavailable: VECTOR_DB_PATH not configured"` without crashing the process.

#### Scenario: Missing VECTOR_DB_PATH at worker startup

- GIVEN `VECTOR_DB_PATH` is unset
- WHEN the workers sidecar starts
- THEN a Pino `error` is logged; the vector store is not initialised; the process does not exit

#### Scenario: vector_search called with unavailable store

- GIVEN the vector store failed to initialise (missing env or load error)
- WHEN the agent calls `vector_search`
- THEN the tool returns a structured error result and the agent continues without crashing

---

### Requirement: Embedding Failure Handling

If `client.embed()` throws during the `index-codebase` job, the error MUST be caught, logged with Pino at `error` level with `{ event: "embed_error", filePath, error: err.message }`, and the file MUST be skipped (its existing chunks, if any, MUST NOT be deleted). The job as a whole MUST still complete with `status=done` unless no files can be processed at all.

If `client.embed()` throws during `vector_search`, the tool MUST return a structured error result with the message `"Embedding failed: <original error message>"`.

#### Scenario: Embed failure during indexing skips file

- GIVEN Ollama returns an error for one file's chunks
- WHEN `index-codebase` processes that file
- THEN the file is skipped, the error is logged, and all other files are indexed normally

#### Scenario: Embed failure during search returns error result

- GIVEN Ollama is unavailable at query time
- WHEN `vector_search` is invoked
- THEN the tool returns `{ error: "Embedding failed: ..." }` and the agent can handle it gracefully

---

### Requirement: HNSW Load Error Recovery

If loading `index.hnsw` from disk fails (corrupt file, version mismatch), the store MUST log a Pino `warn` entry and fall back to creating a fresh empty index. All existing chunk rows in `chunks.db` MUST be deleted to restore consistency between the two stores. The worker MUST continue and the next `index-codebase` job will rebuild from scratch.

#### Scenario: Corrupt index file on startup

- GIVEN `index.hnsw` is truncated or corrupt
- WHEN the vector store initialises
- THEN a `warn` log is emitted; a fresh empty index is created; `chunks.db` is cleared; the worker does not crash

---

## Constraints and Non-Functional Requirements

- All new TypeScript files MUST satisfy `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and `verbatimModuleSyntax` compiler options.
- All imports within the monorepo MUST use `.js` file extensions to comply with NodeNext module resolution.
- `any` MUST NOT be used. `as unknown as T` casts are prohibited.
- Structured logging MUST use the existing Pino logger instance; `console.log` MUST NOT be used in production code paths.
- `pnpm -r build` (tsc compilation only) MUST succeed with zero errors after this change is applied.
- No new routes, HTTP endpoints, or DB migrations on the main app SQLite are introduced by this change.
- The `packages/frontend` package MUST NOT be modified.
