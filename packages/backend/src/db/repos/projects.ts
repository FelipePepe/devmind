import type Database from 'better-sqlite3';

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export class ProjectsRepo {
  constructor(private db: Database.Database) {}

  create(userId: string, name: string, description?: string): Project {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO projects (id, user_id, name, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, userId, name, description ?? null, now, now);
    return this.findById(userId, id) as Project;
  }

  findById(userId: string, projectId: string): Project | undefined {
    return this.db
      .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
      .get(projectId, userId) as Project | undefined;
  }

  findByUser(userId: string): Project[] {
    return this.db
      .prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC')
      .all(userId) as Project[];
  }

  update(userId: string, projectId: string, patch: { name?: string; description?: string | null }): void {
    const current = this.findById(userId, projectId);
    if (!current) return;
    this.db
      .prepare(
        `UPDATE projects
         SET name = ?, description = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
      .run(
        patch.name ?? current.name,
        patch.description !== undefined ? patch.description : current.description,
        new Date().toISOString(),
        projectId,
        userId
      );
  }

  delete(userId: string, projectId: string): void {
    this.db
      .prepare('DELETE FROM projects WHERE id = ? AND user_id = ?')
      .run(projectId, userId);
  }
}
