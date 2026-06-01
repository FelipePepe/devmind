import type { Database } from 'better-sqlite3';

export interface AgentRun {
  id: string;
  session_id: string;
  user_id: string;
  model: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  iterations: number;
  started_at: string;
  ended_at: string | null;
  error: string | null;
}

export class AgentRunsRepo {
  constructor(private db: Database) {}

  create(sessionId: string, userId: string, model: string): AgentRun {
    const row = this.db
      .prepare(
        `INSERT INTO agent_runs (session_id, user_id, model)
         VALUES (?, ?, ?)
         RETURNING *`
      )
      .get(sessionId, userId, model) as AgentRun;
    return row;
  }

  finish(id: string, iterations: number): void {
    this.db
      .prepare(
        `UPDATE agent_runs
         SET status = 'done', iterations = ?, ended_at = datetime('now')
         WHERE id = ?`
      )
      .run(iterations, id);
  }

  fail(id: string, error: string, iterations: number): void {
    this.db
      .prepare(
        `UPDATE agent_runs
         SET status = 'error', error = ?, iterations = ?, ended_at = datetime('now')
         WHERE id = ?`
      )
      .run(error, iterations, id);
  }

  cancel(id: string): void {
    this.db
      .prepare(
        `UPDATE agent_runs
         SET status = 'cancelled', ended_at = datetime('now')
         WHERE id = ?`
      )
      .run(id);
  }

  getBySession(sessionId: string): AgentRun[] {
    return this.db
      .prepare(`SELECT * FROM agent_runs WHERE session_id = ? ORDER BY started_at DESC`)
      .all(sessionId) as AgentRun[];
  }

  findById(id: string): AgentRun | null {
    return (
      (this.db.prepare(`SELECT * FROM agent_runs WHERE id = ?`).get(id) as AgentRun | undefined) ??
      null
    );
  }
}
