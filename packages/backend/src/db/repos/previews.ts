import type Database from 'better-sqlite3';

export type PreviewStatus = 'pending' | 'building' | 'ready' | 'failed';

export interface Preview {
  id: string;
  project_id: string;
  status: PreviewStatus;
  url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export class PreviewsRepo {
  constructor(private db: Database.Database) {}

  findByProject(projectId: string): Preview | undefined {
    return this.db
      .prepare('SELECT * FROM previews WHERE project_id = ?')
      .get(projectId) as Preview | undefined;
  }

  upsert(projectId: string, status: PreviewStatus, url?: string | null, error?: string | null): Preview {
    const now = new Date().toISOString();
    const existing = this.findByProject(projectId);
    if (existing) {
      this.db
        .prepare(
          `UPDATE previews SET status = ?, url = ?, error = ?, updated_at = ? WHERE project_id = ?`
        )
        .run(status, url ?? existing.url, error ?? null, now, projectId);
    } else {
      const id = crypto.randomUUID();
      this.db
        .prepare(
          `INSERT INTO previews (id, project_id, status, url, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, projectId, status, url ?? null, error ?? null, now, now);
    }
    return this.findByProject(projectId) as Preview;
  }
}
