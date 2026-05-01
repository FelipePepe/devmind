import type Database from 'better-sqlite3';

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked';

export interface Task {
  id: string;
  session_id: string;
  title: string;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
}

export class TasksRepo {
  constructor(private db: Database.Database) {}

  create(sessionId: string, title: string): Task {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO tasks (id, session_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?)`
      )
      .run(id, sessionId, title, now, now);
    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task;
  }

  findBySession(sessionId: string): Task[] {
    return this.db
      .prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as Task[];
  }

  updateStatus(taskId: string, status: TaskStatus): void {
    this.db
      .prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), taskId);
  }
}
