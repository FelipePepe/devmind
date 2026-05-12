import type Database from 'better-sqlite3';

export type ChallengeType = 'mfa_login' | 'register_confirm';

export interface AuthChallenge {
  id: string;
  user_id: string | null;
  challenge: string;
  type: ChallengeType;
  expires_at: string;
  created_at: string;
}

export class ChallengesRepo {
  constructor(private db: Database.Database) {}

  create(challenge: string, type: ChallengeType, expiresAt: string, userId?: string): void {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO auth_challenges (id, user_id, challenge, type, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, userId ?? null, challenge, type, expiresAt, now);
  }

  findByChallenge(challenge: string): AuthChallenge | undefined {
    return this.db
      .prepare('SELECT * FROM auth_challenges WHERE challenge = ?')
      .get(challenge) as AuthChallenge | undefined;
  }

  deleteByChallenge(challenge: string): void {
    this.db.prepare('DELETE FROM auth_challenges WHERE challenge = ?').run(challenge);
  }

  deleteExpired(): void {
    this.db
      .prepare("DELETE FROM auth_challenges WHERE expires_at < datetime('now')")
      .run();
  }
}
