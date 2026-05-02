import type Database from 'better-sqlite3';

export interface Session {
  id: string;
  user_id: string;
  title: string;
  project_id: string | null;
  created_at: string;
  archived_at: string | null;
}

export class SessionsRepo {
  constructor(private db: Database.Database) {}

  create(userId: string, title = 'Untitled', projectId?: string): Session {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO sessions (id, user_id, title, project_id, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(id, userId, title, projectId ?? null, now);
    return this.findById(userId, id) as Session;
  }

  findByUser(userId: string): Session[] {
    return this.db
      .prepare(
        'SELECT * FROM sessions WHERE user_id = ? AND archived_at IS NULL ORDER BY created_at DESC'
      )
      .all(userId) as Session[];
  }

  findById(userId: string, sessionId: string): Session | undefined {
    return this.db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId) as Session | undefined;
  }

  archive(userId: string, sessionId: string): void {
    this.db
      .prepare(
        'UPDATE sessions SET archived_at = ? WHERE id = ? AND user_id = ?'
      )
      .run(new Date().toISOString(), sessionId, userId);
  }

  findByProject(projectId: string): Session[] {
    return this.db
      .prepare(
        'SELECT * FROM sessions WHERE project_id = ? AND archived_at IS NULL ORDER BY created_at DESC'
      )
      .all(projectId) as Session[];
  }

  deleteOlderThan(days: number): number {
    const result = this.db
      .prepare(
        `DELETE FROM sessions WHERE archived_at IS NOT NULL
         AND archived_at < datetime('now', ?)`
      )
      .run(`-${days} days`);
    return result.changes;
  }
}
