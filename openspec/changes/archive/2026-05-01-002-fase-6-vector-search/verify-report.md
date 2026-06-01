# Verification Report: 002-fase-6-vector-search

**Date**: 2026-05-01  
**Mode**: Standard (no test runner configured)

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 8 |
| Tasks complete | 8 |
| Tasks incomplete | 0 |

All T01–T08 done ✅

---

## Build & Tests Execution

**Build**: ✅ Passed (`pnpm -r build` exit code 0)

```
packages/workers build: Done
packages/frontend build: Done
packages/backend build: Done
```

**Tests**: ➖ No test runner configured (Standard mode — no strict TDD)  
**Coverage**: ➖ Not available

---

## Spec Compliance Matrix

No test runner exists → all behavioral scenarios are UNTESTED (no runtime evidence).  
Static structural evidence is assessed in the Correctness section.

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Char-Based Sliding Window Chunker | Standard chunking (2000 chars → 4 chunks) | — | ❌ UNTESTED |
| Char-Based Sliding Window Chunker | Short content → 1 chunk | — | ❌ UNTESTED |
| Char-Based Sliding Window Chunker | Empty string → [] | — | ❌ UNTESTED |
| OllamaClient.embed() | Successful batch embed | — | ❌ UNTESTED |
| OllamaClient.embed() | Ollama unreachable → throws | — | ❌ UNTESTED |
| Batched File Embedding | Batch boundary respected (65 chunks → 3 calls) | — | ❌ UNTESTED |
| Batched File Embedding | Empty chunk list → [] | — | ❌ UNTESTED |
| HNSW Initialisation | Fresh init creates files | — | ❌ UNTESTED |
| HNSW Initialisation | Reload on restart preserves data | — | ❌ UNTESTED |
| addChunks() | 5 chunks → 5 rows, hnsw count +5 | — | ❌ UNTESTED |
| HNSW Rebuild Threshold | Rebuild triggered at 21% deleted | — | ❌ UNTESTED |
| HNSW Rebuild Threshold | No rebuild below 20% | — | ❌ UNTESTED |
| Incremental Reindex | Unchanged file skipped | — | ❌ UNTESTED |
| Incremental Reindex | Modified file re-indexed | — | ❌ UNTESTED |
| Incremental Reindex | Deleted file cleaned up | — | ❌ UNTESTED |
| Incremental Reindex | Unreadable file does not abort job | — | ❌ UNTESTED |
| vector_search | Successful semantic search | — | ❌ UNTESTED |
| vector_search | Empty index → [] | — | ❌ UNTESTED |
| vector_search | topK defaults to 5 | — | ❌ UNTESTED |
| vector_search | Invalid input rejected (empty query) | — | ❌ UNTESTED |
| Tool Registration | vector_search visible in registry | — | ❌ UNTESTED |
| VECTOR_DB_PATH guard | Missing at worker startup | — | ❌ UNTESTED |
| VECTOR_DB_PATH guard | vector_search with unavailable store | — | ❌ UNTESTED |
| Embedding Failure Handling | Embed fail during indexing skips file | — | ❌ UNTESTED |
| Embedding Failure Handling | Embed fail during search returns error | — | ❌ UNTESTED |
| HNSW Load Error Recovery | Corrupt index file on startup | — | ❌ UNTESTED |

**Compliance summary**: 0/26 scenarios with runtime evidence (no test runner)

---

## Correctness (Static — Structural Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| `chunkText` sliding window 800/200 | ✅ Implemented | Window=800, stride=600, loop correct |
| `Chunk` type co-located in chunker.ts | ✅ Implemented | Has `filePath`+`hash` (tasks override) |
| `OllamaClient.embed(model, texts[])` | ✅ Implemented | `POST /api/embed`, `{model, input: texts}` |
| `embedTexts` batched ≤32 | ✅ Implemented | Sequential loop, batchSize configurable |
| `VectorIndexStore` WAL + schema | ✅ Implemented | WAL pragma, correct table+indexes |
| HNSW cosine/768/100k | ✅ Implemented | Constants correct |
| `addChunks` atomic transaction | ✅ Implemented | SQLite transaction wraps all inserts + addPoint |
| `deleteChunksByFile` atomicity | ⚠️ Partial | markDelete called outside transaction; DELETE in a separate statement. Not fully atomic per spec |
| HNSW rebuild at >20% deleted | ❌ **CRITICAL** | `shouldRebuild()` is checked but `rebuildIndex()` is **never called** — rebuild is a no-op |
| Incremental reindex pipeline | ✅ Implemented | hash comparison, skip/delete/embed flow correct |
| Deleted file cleanup | ✅ Implemented | Iterates storedHashes for missing files |
| Unreadable file skips gracefully | ✅ Implemented | try/catch per file |
| `vector_search` Zod validation | ✅ Implemented | `safeParse`, min(1), max(2000), topK 1-20 |
| `vector_search` lazy-init read-only | ✅ Implemented | `{ readonly: true }`, `readIndexSync` |
| `vector_search` score = 1 - distance | ✅ Implemented | Correct formula |
| `vector_search` sorted by score desc | ✅ Implemented | `.sort((a,b) => b.score - a.score)` |
| `vectorSearchTool` registered | ✅ Implemented | Present in `createToolRegistry` |
| `VECTOR_DB_PATH` guard in workers | ✅ Implemented | `throw new Error('VECTOR_DB_PATH is not set')` |
| `VECTOR_DB_PATH` guard in backend | ⚠️ Partial | Config has Zod default `'./data/vectors'` — error path unreachable; graceful degradation still works |
| Embed error → file skipped | ✅ Implemented | try/catch per file, logger.warn |
| Corrupt HNSW → fresh rebuild | ✅ Implemented | try/catch in init(), deletes files, recreates |
| `console.log` not used | ✅ Clean | All logging via pino |
| No cross-package imports | ✅ Clean | Workers and backend self-contained |
| TypeScript strict / no `any` | ✅ Clean | Build passes with strict mode |

---

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Workers own all HNSW writes | ✅ Yes | Backend uses `readIndexSync` only |
| No cross-package workspace deps | ✅ Yes | `embed-client.ts` is workers-only |
| Backend adds `hnswlib-node` for kNN | ✅ Yes | Read-only in `vector-search.ts` |
| `Chunk` type co-located in workers | ✅ Yes | Not in shared package |
| WAL mode on chunks.db | ✅ Yes | `PRAGMA journal_mode = WAL` |
| HNSW space=cosine, dim=768 | ✅ Yes | Constants in index-store.ts |

---

## Issues Found

### CRITICAL (must fix before archive)

**C1 — HNSW rebuild never executed**  
`index-codebase.ts` lines 111-113: `shouldRebuild()` is checked but `rebuildIndex()` is never called:
```ts
if (store.shouldRebuild()) {
  logger.info('Delete ratio exceeded threshold — full index rebuild not needed for initial build');
}
```
The rebuild must call `store.rebuildIndex(...)` — otherwise the HNSW index degrades over time with soft-deleted entries never cleaned up. This is a spec requirement (threshold: >20% deleted).

---

### WARNING (should fix)

**W1 — `deleteChunksByFile` is not fully atomic**  
Spec requires markDelete + SQLite delete to be atomic (both succeed or both rollback). Current implementation calls `markDelete` in a plain loop, then `DELETE FROM chunks` in a separate statement. If markDelete throws midway, the SQLite rows are not yet deleted (partial state). Wrapping both in a single SQLite transaction (with error capture for HNSW errors) would satisfy the spec.

**W2 — `VECTOR_DB_PATH` config has Zod default in backend**  
The spec requires: "if VECTOR_DB_PATH is not set → return error `'Vector index unavailable: VECTOR_DB_PATH not configured'`". Because `config.VECTOR_DB_PATH` defaults to `'./data/vectors'`, this error path is never reached. Functionally this is acceptable (the tool will return "Vector index not found — run indexCodebase job first" if files don't exist), but it deviates from the spec's intent.

---

### SUGGESTION

**S1 — Error message inconsistency in vector-search.ts**  
Embed failure returns `"Embed failed: ..."` but spec says `"Embedding failed: ..."`. Minor inconsistency.

**S2 — Add test suite**  
No test runner configured. The 26 spec scenarios have zero runtime evidence. Adding vitest with unit tests for `chunker.ts` and `embed-client.ts` (pure functions, easily testable) would significantly improve confidence.

---

## Adversarial Review

### 🔴 CRITICAL — HNSW index degradation (DoS via fragmentation)

Same as C1 above. An attacker (or heavy normal use) that repeatedly indexes/deletes files will accumulate soft-deleted entries in the HNSW index. Over time, search quality degrades silently and memory grows unbounded. `getCurrentCount()` never shrinks because `markDelete` doesn't physically remove entries. The rebuild that would fix this is never triggered.

### 🟡 WARNING — SQL injection via dynamic IN clause (theoretical)

`vector-search.ts` and `index-store.ts` build dynamic `IN (?,?,?)` clauses using array length to create placeholders. The values are integers from HNSW (`neighbors: number[]`). Currently safe because HNSW labels are integers, but the pattern `labels.map(() => '?').join(',')` could become dangerous if ever adapted for string inputs. Consider using a pre-bound helper.

### 🟡 WARNING — Module-level mutable state in vector-search.ts

`_db` and `_hnsw` are module-level nulls. If `chunks.db` is deleted or re-indexed while the backend is running, the cached handles point to stale/deleted files. No invalidation mechanism exists. Acceptable for a local-first tool but worth noting.

### 🟢 INFO — Workers process has no index refresh signal

When workers finish an index job, the backend's lazy-init `_hnsw` will still point to the old in-memory index until the backend process restarts. Queries made after a re-index will use stale data. No IPC or file-watch mechanism to invalidate the backend cache.

### ✅ No injection risks in Zod-validated inputs

The `vector_search` tool validates `query` (string, 1–2000 chars) and `topK` (int, 1–20) with Zod before any DB or HNSW operations. No path traversal or injection vectors.

---

## Verdict

**PASS WITH WARNINGS** — one CRITICAL issue must be fixed before archive.

- ✅ Build clean, all 8 tasks implemented
- ❌ **C1**: HNSW rebuild logic present but never executed — must fix
- ⚠️ W1: deleteChunksByFile not fully atomic
- ⚠️ W2: VECTOR_DB_PATH config deviation from spec
