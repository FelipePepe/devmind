import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface RefreshTokenRecord {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  created_at: string;
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class RefreshTokensRepo {
  constructor(private db: Database.Database) {}

  create(userId: string, refreshToken: string, expiresAt: string): void {
    this.db
      .prepare(
        `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), userId, hashRefreshToken(refreshToken), expiresAt);
  }

  findActiveByToken(refreshToken: string): RefreshTokenRecord | undefined {
    return this.db
      .prepare(
        `SELECT * FROM refresh_tokens
         WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`
      )
      .get(hashRefreshToken(refreshToken), new Date().toISOString()) as RefreshTokenRecord | undefined;
  }

  revokeToken(refreshToken: string, reason: string): void {
    this.db
      .prepare(
        `UPDATE refresh_tokens
         SET revoked_at = COALESCE(revoked_at, ?), revoke_reason = COALESCE(revoke_reason, ?)
         WHERE token_hash = ?`
      )
      .run(new Date().toISOString(), reason, hashRefreshToken(refreshToken));
  }

  revokeAllForUser(userId: string, reason: string): void {
    this.db
      .prepare(
        `UPDATE refresh_tokens
         SET revoked_at = COALESCE(revoked_at, ?), revoke_reason = COALESCE(revoke_reason, ?)
         WHERE user_id = ? AND revoked_at IS NULL`
      )
      .run(new Date().toISOString(), reason, userId);
  }

  pruneExpired(): number {
    const result = this.db
      .prepare(`DELETE FROM refresh_tokens WHERE expires_at <= ?`)
      .run(new Date().toISOString());
    return result.changes;
  }
}
