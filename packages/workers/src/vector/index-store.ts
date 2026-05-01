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

    this.initialized = true;
  }

  getFileHashes(): Map<string, string> {
    const rows = this.db
      .prepare('SELECT DISTINCT file_path, file_hash FROM chunks')
      .all() as Array<{ file_path: string; file_hash: string }>;
    return new Map(rows.map((r) => [r.file_path, r.file_hash]));
  }

  deleteChunksByFile(filePath: string): void {
    const rows = this.db
      .prepare('SELECT hnsw_label FROM chunks WHERE file_path = ?')
      .all(filePath) as Array<{ hnsw_label: number }>;

    for (const row of rows) {
      try {
        this.hnsw.markDelete(row.hnsw_label);
      } catch (err) {
        logger.warn({ err, hnswLabel: row.hnsw_label }, 'markDelete failed');
      }
    }
    this.db.prepare('DELETE FROM chunks WHERE file_path = ?').run(filePath);
  }

  addChunks(chunks: Chunk[], embeddings: number[][], fileHash: string): void {
    const nextLabel = this._nextHnswLabel();
    const insert = this.db.prepare(`
      INSERT INTO chunks (file_path, file_hash, chunk_hash, start_offset, end_offset, text, hnsw_label)
      VALUES (@filePath, @fileHash, @chunkHash, @startOffset, @endOffset, @text, @hnswLabel)
    `);

    const addAll = this.db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = embeddings[i];
        if (!chunk || !embedding) continue;

        const hnswLabel = nextLabel + i;
        // Grow index if needed
        if (hnswLabel >= this.hnsw.getMaxElements()) {
          this.hnsw.resizeIndex(this.hnsw.getMaxElements() + 10_000);
        }
        this.hnsw.addPoint(embedding, hnswLabel);
        insert.run({
          filePath: chunk.filePath,
          fileHash,
          chunkHash: chunk.hash,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          text: chunk.text,
          hnswLabel,
        });
      }
    });

    addAll();
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
    return result.neighbors.map((label, i) => ({
      hnswLabel: label,
      score: 1 - (result.distances[i] ?? 0),
    }));
  }

  saveIndex(): void {
    this.hnsw.writeIndexSync(this.hnswPath);
    logger.info({ hnswPath: this.hnswPath }, 'HNSW index saved');
  }

  shouldRebuild(): boolean {
    const hnswTotal = this.hnsw.getCurrentCount();
    if (hnswTotal === 0) return false;
    const { count: activeCount } = this.db
      .prepare('SELECT COUNT(*) as count FROM chunks')
      .get() as { count: number };
    const softDeleted = hnswTotal - activeCount;
    return softDeleted / hnswTotal > DELETE_REBUILD_THRESHOLD;
  }

  rebuildIndex(
    allChunks: Chunk[],
    allEmbeddings: number[][],
    fileHashes: Map<string, string>
  ): void {
    logger.info('Rebuilding HNSW index from scratch');
    this.db.prepare('DELETE FROM chunks').run();
    this.hnsw = new HierarchicalNSW(HNSW_SPACE, HNSW_DIMENSIONS);
    this.hnsw.initIndex(Math.max(HNSW_MAX_ELEMENTS, allChunks.length + 1000));

    // Re-add all chunks grouped by file
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

    for (const [filePath, { chunks, embeddings }] of byFile) {
      const hash = fileHashes.get(filePath) ?? '';
      this.addChunks(chunks, embeddings, hash);
    }
  }

  getChunksByLabels(labels: number[]): ChunkRow[] {
    if (labels.length === 0) return [];
    const placeholders = labels.map(() => '?').join(',');
    return this.db
      .prepare(`SELECT * FROM chunks WHERE hnsw_label IN (${placeholders})`)
      .all(...labels) as ChunkRow[];
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
      if (existsSync(this.hnswPath)) unlinkSync(this.hnswPath);
    } catch (err) {
      logger.warn({ err }, 'Failed to delete corrupt store files');
    }
  }
}
