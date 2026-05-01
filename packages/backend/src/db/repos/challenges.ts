import type Database from 'better-sqlite3';

export type ChallengeType = 'registration' | 'authentication';

export interface WebAuthnChallenge {
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
        `INSERT INTO webauthn_challenges (id, user_id, challenge, type, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, userId ?? null, challenge, type, expiresAt, now);
  }

  findByChallenge(challenge: string): WebAuthnChallenge | undefined {
    return this.db
      .prepare('SELECT * FROM webauthn_challenges WHERE challenge = ?')
      .get(challenge) as WebAuthnChallenge | undefined;
  }

  deleteByChallenge(challenge: string): void {
    this.db
      .prepare('DELETE FROM webauthn_challenges WHERE challenge = ?')
      .run(challenge);
  }

  deleteExpired(): void {
    this.db
      .prepare("DELETE FROM webauthn_challenges WHERE expires_at < datetime('now')")
      .run();
  }
}
