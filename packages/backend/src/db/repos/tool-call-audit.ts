import type Database from 'better-sqlite3';

export type ToolSafety = 'read' | 'write' | 'destructive';
export type ToolCallStatus = 'ok' | 'error' | 'blocked' | 'invalid-args';

export interface ToolCallAudit {
  id: string;
  agent_run_id: string | null;
  session_id: string;
  user_id: string;
  project_id: string | null;
  tool_name: string;
  safety: ToolSafety;
  args_json: string;
  status: ToolCallStatus;
  output_excerpt: string;
  error: string | null;
  duration_ms: number;
  started_at: string;
  finished_at: string;
}

export interface AuditStartInput {
  agentRunId: string | null;
  sessionId: string;
  userId: string;
  projectId: string | null;
  toolName: string;
  safety: ToolSafety;
  argsJson: string;
}

export interface AuditFinalInput extends AuditStartInput {
  status: ToolCallStatus;
  outputExcerpt: string;
  error: string | null;
  durationMs: number;
}

const EXCERPT_LIMIT = 2048;

export function excerpt(text: string): string {
  if (!text) return '';
  if (text.length <= EXCERPT_LIMIT) return text;
  return text.slice(0, EXCERPT_LIMIT) + `\n... (truncated ${text.length - EXCERPT_LIMIT} chars)`;
}

export class ToolCallAuditRepo {
  constructor(private db: Database.Database) {}

  /**
   * Insert a provisional row at the moment the executor decides to invoke
   * the tool body. Returns the id so the caller can update it on finish.
   */
  insertStart(input: AuditStartInput): string {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO tool_call_audit
         (id, agent_run_id, session_id, user_id, project_id, tool_name, safety,
          args_json, status, output_excerpt, error, duration_ms,
          started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ok', '', NULL, 0, ?, ?)`
      )
      .run(
        id,
        input.agentRunId,
        input.sessionId,
        input.userId,
        input.projectId,
        input.toolName,
        input.safety,
        input.argsJson,
        now,
        now
      );
    return id;
  }

  /**
   * Insert a fully-formed row in one shot for paths that never reach the
   * tool body: invalid-args, blocked.
   */
  insertFinal(input: AuditFinalInput): string {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO tool_call_audit
         (id, agent_run_id, session_id, user_id, project_id, tool_name, safety,
          args_json, status, output_excerpt, error, duration_ms,
          started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.agentRunId,
        input.sessionId,
        input.userId,
        input.projectId,
        input.toolName,
        input.safety,
        input.argsJson,
        input.status,
        excerpt(input.outputExcerpt),
        input.error,
        input.durationMs,
        now,
        now
      );
    return id;
  }

  /**
   * Update a row previously created with insertStart once the tool body has
   * returned (or thrown).
   */
  updateFinish(
    id: string,
    patch: { status: ToolCallStatus; outputExcerpt: string; error: string | null; durationMs: number }
  ): void {
    this.db
      .prepare(
        `UPDATE tool_call_audit
         SET status = ?, output_excerpt = ?, error = ?, duration_ms = ?, finished_at = ?
         WHERE id = ?`
      )
      .run(
        patch.status,
        excerpt(patch.outputExcerpt),
        patch.error,
        patch.durationMs,
        new Date().toISOString(),
        id
      );
  }

  findRecent(limit: number): ToolCallAudit[] {
    const cap = Math.max(1, Math.min(limit, 500));
    return this.db
      .prepare('SELECT * FROM tool_call_audit ORDER BY started_at DESC LIMIT ?')
      .all(cap) as ToolCallAudit[];
  }
}
