import type Database from 'better-sqlite3';

export interface Artifact {
  id: string;
  user_id: string;
  session_id: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  signed_url_token: string | null;
  signed_url_expires_at: string | null;
  created_at: string;
}

export interface CreateArtifactInput {
  userId: string;
  sessionId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
}

export class ArtifactsRepo {
  constructor(private db: Database.Database) {}

  create(input: CreateArtifactInput): Artifact {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO artifacts
           (id, user_id, session_id, filename, mime_type, size_bytes, storage_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.userId,
        input.sessionId,
        input.filename,
        input.mimeType,
        input.sizeBytes,
        input.storagePath,
        now
      );
    return this.findById(input.userId, id) as Artifact;
  }

  // CRITICAL: ALL reads include user_id filter for ownership isolation
  findById(userId: string, artifactId: string): Artifact | undefined {
    return this.db
      .prepare('SELECT * FROM artifacts WHERE id = ? AND user_id = ?')
      .get(artifactId, userId) as Artifact | undefined;
  }

  findBySession(userId: string, sessionId: string): Artifact[] {
    return this.db
      .prepare(
        'SELECT * FROM artifacts WHERE session_id = ? AND user_id = ? ORDER BY created_at DESC'
      )
      .all(sessionId, userId) as Artifact[];
  }

  findByUser(userId: string): Artifact[] {
    return this.db
      .prepare(
        'SELECT * FROM artifacts WHERE user_id = ? ORDER BY created_at DESC'
      )
      .all(userId) as Artifact[];
  }

  delete(userId: string, artifactId: string): void {
    this.db
      .prepare('DELETE FROM artifacts WHERE id = ? AND user_id = ?')
      .run(artifactId, userId);
  }

  updateSignedUrl(artifactId: string, token: string, expiresAt: string): void {
    this.db
      .prepare(
        'UPDATE artifacts SET signed_url_token = ?, signed_url_expires_at = ? WHERE id = ?'
      )
      .run(token, expiresAt, artifactId);
  }
}
