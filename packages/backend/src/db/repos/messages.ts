import type Database from 'better-sqlite3';

export type MessageRole = 'user' | 'assistant' | 'tool';

export interface Message {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  agent_run_id: string | null;
  created_at: string;
}

export class MessagesRepo {
  constructor(private db: Database.Database) {}

  create(
    sessionId: string,
    role: MessageRole,
    content: string,
    agentRunId?: string | null
  ): Message {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO messages (id, session_id, role, content, agent_run_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(id, sessionId, role, content, agentRunId ?? null, now);
    return this.db
      .prepare('SELECT * FROM messages WHERE id = ?')
      .get(id) as Message;
  }

  findBySession(sessionId: string, limit = 100): Message[] {
    return this.db
      .prepare(
        'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?'
      )
      .all(sessionId, limit) as Message[];
  }
}
