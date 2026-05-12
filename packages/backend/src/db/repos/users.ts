import type Database from 'better-sqlite3';

export interface User {
  id: string;
  display_name: string;
  username: string;
  password_hash: string;
  totp_secret: string | null;
  totp_confirmed: number;
  is_admin: number;
  created_at: string;
}

export interface CreateUserInput {
  displayName: string;
  username: string;
  passwordHash: string;
  totpSecret: string;
}

export class UsersRepo {
  constructor(private db: Database.Database) {}

  create(input: CreateUserInput): User {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO users (id, display_name, username, password_hash, totp_secret, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.displayName, input.username, input.passwordHash, input.totpSecret, now);
    return this.findById(id) as User;
  }

  findById(id: string): User | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
  }

  findByUsername(username: string): User | undefined {
    return this.db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username) as User | undefined;
  }

  confirmTotp(userId: string): void {
    this.db.prepare('UPDATE users SET totp_confirmed = 1 WHERE id = ?').run(userId);
  }

  setAdmin(userId: string, isAdmin: boolean): void {
    this.db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, userId);
  }

  list(): User[] {
    return this.db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as User[];
  }
}
