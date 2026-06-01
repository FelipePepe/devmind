import type Database from 'better-sqlite3';

export type RunStatus = 'pending' | 'running' | 'done' | 'failed';

export interface ProjectRun {
  id: string;
  project_id: string;
  job_id: string | null;
  status: RunStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export class ProjectRunsRepo {
  constructor(private db: Database.Database) {}

  create(projectId: string, jobId?: string): ProjectRun {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO project_runs (id, project_id, job_id, status, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?)`
      )
      .run(id, projectId, jobId ?? null, now, now);
    return this.findById(id) as ProjectRun;
  }

  findById(id: string): ProjectRun | undefined {
    return this.db.prepare('SELECT * FROM project_runs WHERE id = ?').get(id) as ProjectRun | undefined;
  }

  findByProject(projectId: string, limit = 10): ProjectRun[] {
    return this.db
      .prepare('SELECT * FROM project_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(projectId, limit) as ProjectRun[];
  }

  updateStatus(id: string, status: RunStatus, error?: string): void {
    this.db
      .prepare('UPDATE project_runs SET status = ?, error = ?, updated_at = ? WHERE id = ?')
      .run(status, error ?? null, new Date().toISOString(), id);
  }
}
