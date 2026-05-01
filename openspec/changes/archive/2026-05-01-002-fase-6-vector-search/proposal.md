# Proposal: Fase 6 — Vector Search

**Change ID**: 002-fase-6-vector-search  
**Status**: draft  
**Date**: 2025-07-17

---

## Intent

Complete the vector search pipeline that is currently stubbed out in the workers sidecar. The `index-codebase` handler collects and chunks files but discards the chunks without generating embeddings or persisting an index. This change wires up real embeddings via Ollama (`nomic-embed-text`), persists the vector index to `VECTOR_DB_PATH` using `hnswlib-node`, exposes a `vector_search` tool on the backend so the LLM agent can perform semantic code search, and adds incremental reindexation so only changed files are re-embedded on subsequent runs. The result is the core semantic retrieval capability DevMind needs to give the agent relevant context from the local codebase.

---

## Scope

### In scope
- Replace the stub in `packages/workers/src/handlers/index-codebase.ts` with real Ollama embedding calls
- Persist the HNSW index + a chunk metadata table (file path, byte offset, chunk text) to `VECTOR_DB_PATH`
- Chunk strategy: **char-based sliding window** (~800 chars, 200-char overlap) — simple, language-agnostic, predictable size for `nomic-embed-text`'s 8192-token context
- Expose a new `vector_search` tool in `packages/backend/src/tools/` that accepts a natural-language query, embeds it, and returns top-K chunk results with file + offset
- Incremental reindex: track a file content hash in SQLite; skip files whose hash has not changed
- Wire `vector_search` into the existing tool registry

### Out of scope
- AST-aware or language-specific chunking
- Multi-model embedding support or model switching at runtime
- Semantic deduplication of chunks
- UI/frontend changes
- Chunk ranking tuning or re-ranking (BM25 hybrid)
- Remote/cloud vector stores

---

## Approach

- **Chunking**: Implement a pure function `chunkText(content, size=800, overlap=200): Chunk[]` producing `{ text, startOffset, endOffset }` objects. Applied per file in the worker.
- **Embedding**: Call `POST /api/embeddings` on the local Ollama instance (model: `nomic-embed-text`) per chunk, batching where the API allows. Respect the existing `OLLAMA_BASE_URL` config.
- **Index persistence**: Store the HNSW index binary to `VECTOR_DB_PATH/index.hnsw` via `hnswlib-node`. Store chunk metadata (file path, start/end offsets, content hash of source file) in a SQLite database at `VECTOR_DB_PATH/chunks.db` using `better-sqlite3`.
- **Incremental reindex**: On each `index-codebase` job, compute `sha256` of each file. Compare against the hash stored in `chunks.db`. Only re-embed files whose hash differs or that are new; remove stale chunks from both SQLite and the HNSW index.
- **vector_search tool**: Accept `{ query: string, topK?: number }`, embed the query with Ollama, run HNSW `searchKnn`, join result IDs against `chunks.db` to return `{ file, startOffset, endOffset, text, score }[]`.

---

## Affected Packages

| Package | Why |
|---|---|
| `packages/workers` | Core change — `index-codebase` handler gets real embedding + persistence logic |
| `packages/backend` | New `vector_search` tool added to `src/tools/`; tool registry updated |
| `packages/shared` *(if exists)* | Possibly add shared `Chunk` and `VectorSearchResult` types |

No changes to `packages/frontend`.

---

## Risks

1. **Embedding latency / job timeout** — Indexing a large codebase chunk-by-chunk against a local Ollama instance may take minutes. The worker job queue must tolerate long-running jobs or the handler needs progress checkpoints to avoid a stale-job timeout.
2. **HNSW index corruption on partial runs** — If the worker crashes mid-index, the `.hnsw` file and `chunks.db` may be out of sync. Incremental logic must handle a dirty state (e.g., rebuild index from chunks.db on startup if inconsistency is detected).
3. **hnswlib-node native bindings** — The package requires native compilation. If the Docker image or NAS environment lacks build tools, installation will fail silently or at runtime. Must be validated in the actual deploy environment before implementation.

---

## Rollback Plan

The stub behaviour (count chunks, mark job done, return early) can be restored by reverting `index-codebase.ts` to its current state. The `vector_search` tool is additive — removing it from the tool registry leaves the agent unaffected. `VECTOR_DB_PATH` contents can be deleted without impacting the rest of the system. No database migrations on the main app DB are required, so rollback has zero schema risk.

---

## Open Questions

1. **Batch embedding API**: Does the local Ollama instance support batched `/api/embeddings` (array of inputs) or must each chunk be a separate HTTP call? The answer affects parallelism strategy and total indexing time.
2. **HNSW index rebuild vs. incremental delete**: `hnswlib-node` supports `markDelete` but not true removal; deleted slots stay in the graph. At what file-change threshold should we trigger a full index rebuild instead of accumulating deletes?
3. **Shared types package**: Does a `packages/shared` exist and should `Chunk`/`VectorSearchResult` types live there, or stay co-located in `packages/workers` and `packages/backend` respectively?
