import type Database from 'better-sqlite3';

export interface User {
  id: string;
  display_name: string;
  credential_id: string;
  credential: string;
  is_admin: number;
  created_at: string;
}

export interface CreateUserInput {
  displayName: string;
  credentialId: string;
  credential: string;
}

export class UsersRepo {
  constructor(private db: Database.Database) {}

  create(input: CreateUserInput): User {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO users (id, display_name, credential_id, credential, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, input.displayName, input.credentialId, input.credential, now);
    return this.findById(id) as User;
  }

  findById(id: string): User | undefined {
    return this.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(id) as User | undefined;
  }

  findByCredentialId(credentialId: string): User | undefined {
    return this.db
      .prepare('SELECT * FROM users WHERE credential_id = ?')
      .get(credentialId) as User | undefined;
  }

  updateCredential(userId: string, credentialId: string, credential: string): void {
    this.db
      .prepare(
        'UPDATE users SET credential_id = ?, credential = ? WHERE id = ?'
      )
      .run(credentialId, credential, userId);
  }

  setAdmin(userId: string, isAdmin: boolean): void {
    this.db
      .prepare('UPDATE users SET is_admin = ? WHERE id = ?')
      .run(isAdmin ? 1 : 0, userId);
  }

  list(): User[] {
    return this.db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as User[];
  }
}
