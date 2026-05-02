import type Database from 'better-sqlite3';

export interface Screen {
  id: string;
  project_id: string;
  name: string;
  path: string;
  created_at: string;
  updated_at: string;
}

export class ScreensRepo {
  constructor(private db: Database.Database) {}

  create(projectId: string, name: string, path: string): Screen {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO screens (id, project_id, name, path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, projectId, name, path, now, now);
    return this.findById(projectId, id) as Screen;
  }

  findById(projectId: string, screenId: string): Screen | undefined {
    return this.db
      .prepare('SELECT * FROM screens WHERE id = ? AND project_id = ?')
      .get(screenId, projectId) as Screen | undefined;
  }

  findByProject(projectId: string): Screen[] {
    return this.db
      .prepare('SELECT * FROM screens WHERE project_id = ? ORDER BY created_at ASC')
      .all(projectId) as Screen[];
  }
}
