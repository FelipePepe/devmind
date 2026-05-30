import type Database from 'better-sqlite3';
import type { MessageEvidence } from './project-tests.js';

export type MessageRole = 'user' | 'assistant' | 'tool';

export interface Message {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  agent_run_id: string | null;
  evidence_json: string | null;
  created_at: string;
}

export interface MessageWithSnapshot extends Message {
  linked_snapshot_id: string | null;
}

export interface MessageWithEvidence extends MessageWithSnapshot {
  evidence: MessageEvidence | null;
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

  findBySession(sessionId: string, limit = 100): MessageWithEvidence[] {
    return this.db
      .prepare(
        `SELECT m.*, s.id AS linked_snapshot_id
         FROM messages m
         LEFT JOIN project_snapshots s ON s.message_id = m.id
         WHERE m.session_id = ?
         ORDER BY m.created_at ASC
         LIMIT ?`
      )
      .all(sessionId, limit)
      .map((row) => parseEvidence(row as MessageWithSnapshot)) as MessageWithEvidence[];
  }

  attachEvidence(messageId: string, evidence: MessageEvidence): void {
    this.db
      .prepare('UPDATE messages SET evidence_json = ? WHERE id = ?')
      .run(JSON.stringify(evidence), messageId);
  }
}

function parseEvidence(row: MessageWithSnapshot): MessageWithEvidence {
  return {
    ...row,
    evidence: row.evidence_json ? (JSON.parse(row.evidence_json) as MessageEvidence) : null,
  };
}
