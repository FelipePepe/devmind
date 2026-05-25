import type Database from 'better-sqlite3';

export interface ProjectSnapshotBlob {
  hash: string;
  content: Buffer;
  size_bytes: number;
  ref_count: number;
  created_at: string;
}

export class ProjectSnapshotBlobsRepo {
  constructor(private db: Database.Database) {}

  getByHash(hash: string): ProjectSnapshotBlob | undefined {
    return this.db
      .prepare('SELECT * FROM project_snapshot_blobs WHERE hash = ?')
      .get(hash) as ProjectSnapshotBlob | undefined;
  }

  writeIfMissing(hash: string, content: Buffer): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO project_snapshot_blobs (hash, content, size_bytes, ref_count)
         VALUES (?, ?, ?, 0)`
      )
      .run(hash, content, content.length);
    return result.changes > 0;
  }

  incrementRef(hashes: string[]): void {
    if (hashes.length === 0) return;
    const placeholders = hashes.map(() => '?').join(',');
    this.db
      .prepare(
        `UPDATE project_snapshot_blobs SET ref_count = ref_count + 1 WHERE hash IN (${placeholders})`
      )
      .run(...hashes);
  }

  decrementRef(hashes: string[]): void {
    if (hashes.length === 0) return;
    const placeholders = hashes.map(() => '?').join(',');
    this.db
      .prepare(
        `UPDATE project_snapshot_blobs SET ref_count = ref_count - 1 WHERE hash IN (${placeholders})`
      )
      .run(...hashes);
  }

  deleteOrphans(): number {
    return this.db
      .prepare('DELETE FROM project_snapshot_blobs WHERE ref_count <= 0')
      .run().changes;
  }
}
