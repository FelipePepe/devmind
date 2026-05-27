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
    this.adjustRef(hashes, 1);
  }

  decrementRef(hashes: string[]): void {
    this.adjustRef(hashes, -1);
  }

  private adjustRef(hashes: string[], delta: number): void {
    if (hashes.length === 0) return;
    // Duplicates matter: a single snapshot can list the same blob once, but
    // prune/compact pass a flat list across multiple snapshots, so [A, A] must
    // shift A's ref_count by 2 — not 1 as a `WHERE hash IN (?, ?)` UPDATE would.
    const counts = new Map<string, number>();
    for (const h of hashes) counts.set(h, (counts.get(h) ?? 0) + 1);
    const stmt = this.db.prepare(
      'UPDATE project_snapshot_blobs SET ref_count = ref_count + ? WHERE hash = ?'
    );
    const tx = this.db.transaction(() => {
      for (const [hash, count] of counts) stmt.run(delta * count, hash);
    });
    tx();
  }

  deleteOrphans(): number {
    return this.db
      .prepare('DELETE FROM project_snapshot_blobs WHERE ref_count <= 0')
      .run().changes;
  }
}
