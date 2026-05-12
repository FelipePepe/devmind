import type Database from 'better-sqlite3';

export interface Component {
  id: string;
  project_id: string;
  name: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export class ComponentsRepo {
  constructor(private db: Database.Database) {}

  create(projectId: string, name: string, content = ''): Component {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO components (id, project_id, name, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, projectId, name, content, now, now);
    return this.findById(id) as Component;
  }

  findById(id: string): Component | undefined {
    return this.db
      .prepare('SELECT * FROM components WHERE id = ?')
      .get(id) as Component | undefined;
  }

  findByProject(projectId: string): Component[] {
    return this.db
      .prepare('SELECT * FROM components WHERE project_id = ? ORDER BY created_at ASC')
      .all(projectId) as Component[];
  }

  update(id: string, patch: { name?: string; content?: string }): Component | undefined {
    const current = this.findById(id);
    if (!current) return undefined;
    this.db
      .prepare(
        `UPDATE components SET name = ?, content = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        patch.name ?? current.name,
        patch.content !== undefined ? patch.content : current.content,
        new Date().toISOString(),
        id
      );
    return this.findById(id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM components WHERE id = ?').run(id);
  }
}
