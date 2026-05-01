import { existsSync, unlinkSync } from 'node:fs';
import { HierarchicalNSW } from 'hnswlib-node';
import Database from 'better-sqlite3';
import type { Chunk } from './chunker.js';
import { logger } from '../logger.js';

const HNSW_DIMENSIONS = 768;
const HNSW_MAX_ELEMENTS = 100_000;
const HNSW_SPACE = 'cosine' as const;
const DELETE_REBUILD_THRESHOLD = 0.2;

interface ChunkRow {
  id: number;
  file_path: string;
  file_hash: string;
  chunk_hash: string;
  start_offset: number;
  end_offset: number;
  text: string;
  hnsw_label: number;
  embedding: Buffer;
}

export class VectorIndexStore {
  private db: Database.Database;
  private hnsw: HierarchicalNSW;
  private initialized = false;
  private countChunksStmt: Database.Statement | undefined;
  private _forceRebuild = false;

  constructor(
    private readonly dbPath: string,
    private readonly hnswPath: string
  ) {
    this.db = new Database(dbPath);
    this.hnsw = new HierarchicalNSW(HNSW_SPACE, HNSW_DIMENSIONS);
  }

  private _assertInitialized(): void {
    if (!this.initialized) throw new Error('VectorIndexStore must be awaited with init() before use');
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path    TEXT    NOT NULL,
        file_hash    TEXT    NOT NULL,
        chunk_hash   TEXT    NOT NULL,
        start_offset INTEGER NOT NULL,
        end_offset   INTEGER NOT NULL,
        text         TEXT    NOT NULL,
        hnsw_label   INTEGER NOT NULL UNIQUE,
        indexed_at   INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
        embedding    BLOB    NOT NULL DEFAULT X''
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_file_path  ON chunks(file_path);
      CREATE INDEX IF NOT EXISTS idx_chunks_hnsw_label ON chunks(hnsw_label);
    `);

    // Migrate existing DBs that don't have the embedding column yet.
    try {
      this.db.exec(`ALTER TABLE chunks ADD COLUMN embedding BLOB NOT NULL DEFAULT X''`);
    } catch {
      // Column already exists — ignore duplicate column name error.
    }

    if (existsSync(this.hnswPath)) {
      try {
        await this.hnsw.readIndex(this.hnswPath);
        logger.info({ hnswPath: this.hnswPath }, 'HNSW index loaded');
      } catch (err) {
        // Keep the DB intact. Only delete the corrupt HNSW file and rebuild on next run.
        logger.warn(
          { err, event: 'hnsw_corrupt_recovery', strategy: 'keep_db_force_rebuild' },
          'HNSW index corrupt — deleting HNSW file only, keeping DB, scheduling rebuild'
        );
        try {
          unlinkSync(this.hnswPath);
        } catch (unlinkErr) {
          logger.error({ err: unlinkErr, hnswPath: this.hnswPath }, 'Failed to delete corrupt HNSW file');
        }
        this.hnsw = new HierarchicalNSW(HNSW_SPACE, HNSW_DIMENSIONS);
        this.hnsw.initIndex(HNSW_MAX_ELEMENTS);
        this._forceRebuild = true;
      }
    } else {
      this.hnsw.initIndex(HNSW_MAX_ELEMENTS);
    }

    this.countChunksStmt = this.db.prepare('SELECT COUNT(*) as count FROM chunks');
    this.initialized = true;
  }

  getFileHashes(): Map<string, string> {
    this._assertInitialized();
    const rows = this.db
      .prepare('SELECT file_path, MAX(file_hash) as file_hash FROM chunks GROUP BY file_path ORDER BY MAX(indexed_at) DESC')
      .all() as Array<{ file_path: string; file_hash: string }>;
    return new Map(rows.map((r) => [r.file_path, r.file_hash]));
  }

  deleteChunksByFile(filePath: string): void {
    this._assertInitialized();
    const rows = this.db
      .prepare('SELECT hnsw_label FROM chunks WHERE file_path = ?')
      .all(filePath) as Array<{ hnsw_label: number }>;

    const successfulLabels: number[] = [];
    for (const row of rows) {
      try {
        this.hnsw.markDelete(row.hnsw_label);
        successfulLabels.push(row.hnsw_label);
      } catch (err) {
        logger.warn({ err, hnswLabel: row.hnsw_label }, 'markDelete failed — skipping DB delete for this label');
      }
    }

    if (successfulLabels.length === 0) return;

    const SQLITE_MAX_VARS = 999;
    try {
      if (successfulLabels.length === rows.length) {
        this.db.prepare('DELETE FROM chunks WHERE file_path = ?').run(filePath);
      } else {
        for (let i = 0; i < successfulLabels.length; i += SQLITE_MAX_VARS) {
          const batch = successfulLabels.slice(i, i + SQLITE_MAX_VARS);
          const placeholders = batch.map(() => '?').join(',');
          this.db.prepare(`DELETE FROM chunks WHERE hnsw_label IN (${placeholders})`).run(...batch);
        }
      }
    } catch (err) {
      logger.warn(
        { err, filePath, orphanedLabels: successfulLabels.length },
        'deleteChunksByFile: DB delete failed after HNSW markDelete — scheduling forced rebuild'
      );
      this._forceRebuild = true;
    }
  }

  addChunks(chunks: Chunk[], embeddings: number[][], fileHash: string): void {
    this._assertInitialized();
    const nextLabel = this._nextHnswLabel();
    const insert = this.db.prepare(`
      INSERT INTO chunks (file_path, file_hash, chunk_hash, start_offset, end_offset, text, hnsw_label, embedding)
      VALUES (@filePath, @fileHash, @chunkHash, @startOffset, @endOffset, @text, @hnswLabel, @embedding)
    `);

    const pendingPoints: Array<{ label: number; embedding: number[] }> = [];

    const addAll = this.db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = embeddings[i];
        if (!chunk || !embedding) continue;

        const hnswLabel = nextLabel + i;
        insert.run({
          filePath: chunk.filePath,
          fileHash,
          chunkHash: chunk.hash,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          text: chunk.text,
          hnswLabel,
          embedding: Buffer.from(new Float32Array(embedding).buffer),
        });
        pendingPoints.push({ label: hnswLabel, embedding });
      }
    });

    addAll();

    // Add to HNSW only after the DB transaction commits successfully.
    // If addPoint fails here, HNSW/DB diverge but this is recoverable on next rebuild.
    for (const { label, embedding } of pendingPoints) {
      if (label >= this.hnsw.getMaxElements()) {
        this.hnsw.resizeIndex(this.hnsw.getMaxElements() + 10_000);
      }
      try {
        this.hnsw.addPoint(embedding, label);
      } catch (err) {
        logger.warn({ err, hnswLabel: label }, 'hnsw.addPoint failed after DB commit — HNSW/DB may diverge, will recover on next rebuild');
      }
    }
  }

  getAllFilePaths(): Set<string> {
    this._assertInitialized();
    const rows = this.db
      .prepare('SELECT DISTINCT file_path FROM chunks')
      .all() as Array<{ file_path: string }>;
    return new Set(rows.map((r) => r.file_path));
  }

  /**
   * Returns stored chunks and embeddings for a file from the DB.
   * Returns null if no rows exist or any row has an empty embedding blob (legacy — needs re-embedding).
   */
  getFileChunksAndEmbeddings(
    filePath: string
  ): { chunks: Chunk[]; embeddings: number[][]; fileHash: string } | null {
    this._assertInitialized();
    const rows = this.db
      .prepare(
        'SELECT chunk_hash, file_hash, start_offset, end_offset, text, hnsw_label, embedding FROM chunks WHERE file_path = ? ORDER BY hnsw_label'
      )
      .all(filePath) as Array<{
        chunk_hash: string;
        file_hash: string;
        start_offset: number;
        end_offset: number;
        text: string;
        hnsw_label: number;
        embedding: Buffer;
      }>;

    if (rows.length === 0) return null;

    // Any empty blob means a legacy row — fall back to re-embedding the entire file.
    for (const row of rows) {
      if (row.embedding.length === 0) return null;
    }

    const fileHash = rows[0]!.file_hash;
    const chunks: Chunk[] = rows.map((row) => ({
      filePath,
      hash: row.chunk_hash,
      startOffset: row.start_offset,
      endOffset: row.end_offset,
      text: row.text,
    }));
    const embeddings: number[][] = rows.map((row) =>
      Array.from(new Float32Array(new Uint8Array(row.embedding).buffer))
    );

    return { chunks, embeddings, fileHash };
  }

  searchKnn(
    queryEmbedding: number[],
    k: number
  ): Array<{ hnswLabel: number; score: number }> {
    this._assertInitialized();
    if (queryEmbedding.length !== HNSW_DIMENSIONS) {
      logger.warn(
        { got: queryEmbedding.length, expected: HNSW_DIMENSIONS },
        'searchKnn: wrong embedding dimensions — returning empty results'
      );
      return [];
    }

    const total = this.hnsw.getCurrentCount();
    if (total === 0) return [];

    const actualK = Math.min(k, total);
    const result = this.hnsw.searchKnn(queryEmbedding, actualK);

    if (result.distances.length !== result.neighbors.length) {
      logger.warn(
        { neighbors: result.neighbors.length, distances: result.distances.length },
        'searchKnn: hnswlib returned mismatched neighbors/distances arrays — truncating to shorter length'
      );
    }

    const len = Math.min(result.neighbors.length, result.distances.length);
    return Array.from({ length: len }, (_, i) => ({
      hnswLabel: result.neighbors[i] as number,
      score: 1 - (result.distances[i] as number),
    }));
  }

  saveIndex(): void {
    this._assertInitialized();
    this.hnsw.writeIndexSync(this.hnswPath);
    logger.info({ hnswPath: this.hnswPath }, 'HNSW index saved');
  }

  shouldRebuild(): boolean {
    this._assertInitialized();
    if (this._forceRebuild) {
      logger.warn('Forced rebuild due to previous deleteChunksByFile DB failure');
      // NOTE: _forceRebuild is cleared in rebuildIndex() after success, not here.
      // If shouldRebuild() returns true but rebuildIndex() throws, the flag survives.
      return true;
    }
    const hnswTotal = this.hnsw.getCurrentCount();
    const { count: activeCount } = this.countChunksStmt!.get() as { count: number };
    if (hnswTotal === 0) {
      if (activeCount > 0) {
        logger.warn({ activeCount }, 'HNSW is empty but DB has active chunks — forcing rebuild');
        return true;
      }
      return false;
    }
    const softDeleted = hnswTotal - activeCount;
    if (softDeleted < 0) {
      logger.warn({ hnswTotal, activeCount }, 'HNSW/DB divergence detected: activeCount > hnswTotal — forcing rebuild');
      return true;
    }
    return softDeleted / hnswTotal > DELETE_REBUILD_THRESHOLD;
  }

  rebuildIndex(
    allChunks: Chunk[],
    allEmbeddings: number[][],
    fileHashes: Map<string, string>
  ): void {
    this._assertInitialized();
    logger.info('Rebuilding HNSW index from scratch');
    const newHnsw = new HierarchicalNSW(HNSW_SPACE, HNSW_DIMENSIONS);
    newHnsw.initIndex(Math.max(HNSW_MAX_ELEMENTS, allChunks.length + 1000));

    const byFile = new Map<string, { chunks: Chunk[]; embeddings: number[][] }>();
    for (let i = 0; i < allChunks.length; i++) {
      const chunk = allChunks[i];
      const emb = allEmbeddings[i];
      if (!chunk || !emb) continue;
      const entry = byFile.get(chunk.filePath) ?? { chunks: [], embeddings: [] };
      entry.chunks.push(chunk);
      entry.embeddings.push(emb);
      byFile.set(chunk.filePath, entry);
    }

    const insert = this.db.prepare(`
      INSERT INTO chunks (file_path, file_hash, chunk_hash, start_offset, end_offset, text, hnsw_label, embedding)
      VALUES (@filePath, @fileHash, @chunkHash, @startOffset, @endOffset, @text, @hnswLabel, @embedding)
    `);
    const pendingPoints: Array<{ label: number; embedding: number[] }> = [];

    const rebuildTx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM chunks').run();
      let labelCounter = 0;
      for (const [filePath, { chunks, embeddings }] of byFile) {
        const hash = fileHashes.get(filePath);
        if (!hash) {
          logger.warn({ filePath }, 'rebuildIndex: missing file hash — skipping file');
          continue;
        }
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const embedding = embeddings[i];
          if (!chunk || !embedding) continue;
          const hnswLabel = labelCounter++;
          insert.run({
            filePath: chunk.filePath,
            fileHash: hash,
            chunkHash: chunk.hash,
            startOffset: chunk.startOffset,
            endOffset: chunk.endOffset,
            text: chunk.text,
            hnswLabel,
            embedding: Buffer.from(new Float32Array(embedding).buffer),
          });
          pendingPoints.push({ label: hnswLabel, embedding });
        }
      }
    });

    rebuildTx(); // If this throws, newHnsw is discarded — this.hnsw remains valid

    let failedAddPoints = 0;
    for (const { label, embedding } of pendingPoints) {
      if (label >= newHnsw.getMaxElements()) {
        newHnsw.resizeIndex(newHnsw.getMaxElements() + 10_000);
      }
      try {
        newHnsw.addPoint(embedding, label);
      } catch (err) {
        failedAddPoints++;
        logger.warn({ err, hnswLabel: label }, 'hnsw.addPoint failed during rebuild');
      }
    }

    if (failedAddPoints > 0) {
      logger.error(
        { failedAddPoints, total: pendingPoints.length },
        'rebuildIndex: some addPoint calls failed — scheduling next run to rebuild again'
      );
      this._forceRebuild = true;
    } else {
      this._forceRebuild = false;
    }

    this.hnsw = newHnsw;
  }

  markRebuildNeeded(): void {
    this._forceRebuild = true;
  }

  getChunksByLabels(labels: number[]): ChunkRow[] {
    this._assertInitialized();
    if (labels.length === 0) return [];
    const SQLITE_MAX_VARS = 999;
    const rowMap = new Map<number, ChunkRow>();
    for (let i = 0; i < labels.length; i += SQLITE_MAX_VARS) {
      const batch = labels.slice(i, i + SQLITE_MAX_VARS);
      const placeholders = batch.map(() => '?').join(',');
      const rows = this.db
        .prepare(`SELECT * FROM chunks WHERE hnsw_label IN (${placeholders})`)
        .all(...batch) as ChunkRow[];
      for (const row of rows) rowMap.set(row.hnsw_label, row);
    }
    return labels.flatMap((label) => {
      const row = rowMap.get(label);
      return row ? [row] : [];
    });
  }

  close(): void {
    this.db.close();
  }

  private _nextHnswLabel(): number {
    const row = this.db
      .prepare('SELECT MAX(hnsw_label) as max_label FROM chunks')
      .get() as { max_label: number | null };
    return (row.max_label ?? -1) + 1;
  }

  private _deleteStoreFiles(): void {
    const failures: Array<{ file: string; err: unknown }> = [];
    // Delete HNSW first to prevent a stale index being loaded with a freshly re-created empty DB.
    const filesToDelete = [
      this.hnswPath,
      this.dbPath + '-shm',
      this.dbPath + '-wal',
      this.dbPath,
    ];
    for (const file of filesToDelete) {
      try {
        if (existsSync(file)) unlinkSync(file);
      } catch (err) {
        logger.error({ err, failedFile: file }, 'Failed to delete corrupt store file');
        failures.push({ file, err });
      }
    }
    if (failures.length > 0) {
      throw new Error(`Failed to delete store files: ${failures.map((f) => f.file).join(', ')}`);
    }
  }
}
