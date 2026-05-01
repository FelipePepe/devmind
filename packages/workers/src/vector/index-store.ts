import { existsSync, unlinkSync } from 'node:fs';
import { HierarchicalNSW } from 'hnswlib-node';
import Database from 'better-sqlite3';
import pino from 'pino';
import type { Chunk } from './chunker.js';

const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

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
}

export class VectorIndexStore {
  private db: Database.Database;
  private hnsw: HierarchicalNSW;
  private initialized = false;
  private countChunksStmt!: Database.Statement;
  private _forceRebuild = false;

  constructor(
    private readonly dbPath: string,
    private readonly hnswPath: string
  ) {
    this.db = new Database(dbPath);
    this.hnsw = new HierarchicalNSW(HNSW_SPACE, HNSW_DIMENSIONS);
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    this.db.pragma('journal_mode = WAL');
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
        indexed_at   INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_file_path  ON chunks(file_path);
      CREATE INDEX IF NOT EXISTS idx_chunks_hnsw_label ON chunks(hnsw_label);
    `);

    if (existsSync(this.hnswPath)) {
      try {
        await this.hnsw.readIndex(this.hnswPath);
        logger.info({ hnswPath: this.hnswPath }, 'HNSW index loaded');
      } catch (err) {
        logger.warn({ err }, 'HNSW index corrupt — rebuilding from scratch');
        this.db.close();
        this._deleteStoreFiles();
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');
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
            indexed_at   INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
          );
          CREATE INDEX IF NOT EXISTS idx_chunks_file_path  ON chunks(file_path);
          CREATE INDEX IF NOT EXISTS idx_chunks_hnsw_label ON chunks(hnsw_label);
        `);
        this.hnsw = new HierarchicalNSW(HNSW_SPACE, HNSW_DIMENSIONS);
        this.hnsw.initIndex(HNSW_MAX_ELEMENTS);
      }
    } else {
      this.hnsw.initIndex(HNSW_MAX_ELEMENTS);
    }

    this.countChunksStmt = this.db.prepare('SELECT COUNT(*) as count FROM chunks');
    this.initialized = true;
  }

  getFileHashes(): Map<string, string> {
    const rows = this.db
      .prepare('SELECT file_path, MAX(file_hash) as file_hash FROM chunks GROUP BY file_path ORDER BY MAX(indexed_at) DESC')
      .all() as Array<{ file_path: string; file_hash: string }>;
    return new Map(rows.map((r) => [r.file_path, r.file_hash]));
  }

  deleteChunksByFile(filePath: string): void {
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
    const nextLabel = this._nextHnswLabel();
    const insert = this.db.prepare(`
      INSERT INTO chunks (file_path, file_hash, chunk_hash, start_offset, end_offset, text, hnsw_label)
      VALUES (@filePath, @fileHash, @chunkHash, @startOffset, @endOffset, @text, @hnswLabel)
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
    const rows = this.db
      .prepare('SELECT DISTINCT file_path FROM chunks')
      .all() as Array<{ file_path: string }>;
    return new Set(rows.map((r) => r.file_path));
  }

  searchKnn(
    queryEmbedding: number[],
    k: number
  ): Array<{ hnswLabel: number; score: number }> {
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
    this.hnsw.writeIndexSync(this.hnswPath);
    logger.info({ hnswPath: this.hnswPath }, 'HNSW index saved');
  }

  shouldRebuild(): boolean {
    if (this._forceRebuild) {
      logger.warn('Forced rebuild due to previous deleteChunksByFile DB failure');
      // NOTE: _forceRebuild is cleared in rebuildIndex() after success, not here.
      // If shouldRebuild() returns true but rebuildIndex() throws, the flag survives.
      return true;
    }
    const hnswTotal = this.hnsw.getCurrentCount();
    const { count: activeCount } = this.countChunksStmt.get() as { count: number };
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
      INSERT INTO chunks (file_path, file_hash, chunk_hash, start_offset, end_offset, text, hnsw_label)
      VALUES (@filePath, @fileHash, @chunkHash, @startOffset, @endOffset, @text, @hnswLabel)
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
          });
          pendingPoints.push({ label: hnswLabel, embedding });
        }
      }
    });

    rebuildTx(); // If this throws, newHnsw is discarded — this.hnsw remains valid

    for (const { label, embedding } of pendingPoints) {
      if (label >= newHnsw.getMaxElements()) {
        newHnsw.resizeIndex(newHnsw.getMaxElements() + 10_000);
      }
      try {
        newHnsw.addPoint(embedding, label);
      } catch (err) {
        logger.warn({ err, hnswLabel: label }, 'hnsw.addPoint failed during rebuild — will recover on next shouldRebuild check');
      }
    }

    this.hnsw = newHnsw;
    this._forceRebuild = false;
  }

  getChunksByLabels(labels: number[]): ChunkRow[] {
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

  private _nextHnswLabel(): number {
    const row = this.db
      .prepare('SELECT MAX(hnsw_label) as max_label FROM chunks')
      .get() as { max_label: number | null };
    return (row.max_label ?? -1) + 1;
  }

  private _deleteStoreFiles(): void {
    try {
      if (existsSync(this.dbPath)) unlinkSync(this.dbPath);
      if (existsSync(this.dbPath + '-wal')) unlinkSync(this.dbPath + '-wal');
      if (existsSync(this.dbPath + '-shm')) unlinkSync(this.dbPath + '-shm');
      if (existsSync(this.hnswPath)) unlinkSync(this.hnswPath);
    } catch (err) {
      logger.error({ err }, 'Failed to delete corrupt store files — cannot recover');
      throw err;
    }
  }
}
