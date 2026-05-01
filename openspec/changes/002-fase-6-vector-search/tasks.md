# Tasks: 002-fase-6-vector-search

> **Status**: in-progress (hardening)
> **Change ID**: 002-fase-6-vector-search
> **Updated**: 2025-07-18 — post-Judgment Day rounds 1-3 applied

---

## Phase 1 — Core Implementation ✅

- [x] 1.1 Create `packages/workers/src/vector/chunker.ts` — sliding window (800 chars, 200 overlap)
- [x] 1.2 Create `packages/workers/src/vector/embed-client.ts` — thin HTTP client for Ollama `/api/embed`, batches ≤ 32
- [x] 1.3 Create `packages/workers/src/vector/index-store.ts` — VectorIndexStore (SQLite + HNSW dual store)
- [x] 1.4 Replace stub in `packages/workers/src/handlers/index-codebase.ts` with real incremental indexing pipeline
- [x] 1.5 Add `embed(model, texts): Promise<number[][]>` to `packages/backend/src/ollama/client.ts`
- [x] 1.6 Create `packages/backend/src/tools/impl/vector-search.ts` — agent tool, read-only HNSW + SQLite
- [x] 1.7 Register `vector_search` in `packages/backend/src/tools/index.ts`
- [x] 1.8 `pnpm -r build` passes — zero TypeScript errors

## Phase 2 — Hardening (Judgment Day rounds 1-3) ✅

- [x] 2.1 Fix C1: `shouldRebuild()` derives `softDeleted` from `hnsw.getCurrentCount() - SQLite COUNT(*)` — persistent across restarts
- [x] 2.2 Fix CRITICAL (Round 1): Move `addPoint` calls outside SQLite transaction — collect `pendingPoints`, add after commit
- [x] 2.3 Fix CRITICAL (Round 1): `rebuildIndex` wrapped in outer `db.transaction()` for atomicity
- [x] 2.4 Fix CRITICAL (Round 2): `this.hnsw` replaced only after TX succeeds — use local `newHnsw` var
- [x] 2.5 Fix: HNSW `addPoints` outside TX scope in `rebuildIndex`; `shouldRebuild()` guards `hnswTotal === 0` and `softDeleted < 0`
- [x] 2.6 Fix: `_deleteStoreFiles()` throws on failure — no silent swallowing of errors
- [x] 2.7 Fix: `getChunksByLabels` preserves kNN distance order via `Map<label, row>`
- [x] 2.8 Fix: `getFileHashes` uses `MAX(indexed_at)` for deterministic GROUP BY result
- [x] 2.9 Fix: `deleteChunksByFile` sets `_forceRebuild` flag on HNSW-DB divergence
- [x] 2.10 Fix: `collectFiles` guards realRoot containment for symlinked directories; removed `saveIndex()` from error handler
- [x] 2.11 Fix: SQLite IN-clause batches < 999; `_deleteStoreFiles` removes WAL/SHM sidecar files
- [x] 2.12 `pnpm -r build` passes ✅ — branch: `fix/fase-6-hnsw-rebuild`

## Phase 3 — Round 4 Fixes (Pending)

- [ ] 3.1 `index-codebase.ts`: move `store.init()` inside try/catch — CRITICAL regression (unhandled rejection blocks job queue)
- [ ] 3.2 `index-store.ts`: reset `_forceRebuild` AFTER `rebuildIndex()` succeeds, not inside `shouldRebuild()`
- [ ] 3.3 `index-store.ts`: fix `getFileHashes` GROUP BY — use `MAX(file_hash)` aggregate for full determinism
- [ ] 3.4 `index-codebase.ts`: check symlink-to-file containment in `collectFiles` after `exts.some()` match

## Phase 4 — Release

- [ ] 4.1 `pnpm -r build` — verify zero errors after Round 4 fixes
- [ ] 4.2 Commit Round 4 fixes to `fix/fase-6-hnsw-rebuild`
- [ ] 4.3 Launch Round 5 Judgment Day — both judges must pass clean (no new CRITICALs)
- [ ] 4.4 `gh pr create --base develop --title "fix(vector): C1 + HNSW atomicity hardening (Judgment Day)"`
- [ ] 4.5 `sdd archive 002-fase-6-vector-search` after PR merges to develop
