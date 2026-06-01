import type Database from 'better-sqlite3';

export interface User {
  id: string;
  display_name: string;
  username: string;
  password_hash: string;
  totp_secret: string | null;
  totp_confirmed: number;
  is_admin: number;
  email: string | null;
  kc_subject: string | null;
  created_at: string;
}

export interface CreateUserInput {
  displayName: string;
  username: string;
  passwordHash: string;
  totpSecret: string;
}

export interface CreateFromOidcInput {
  kcSubject: string;
  email: string;
  username: string;
  displayName?: string;
}

// Sentinel password hash for OIDC-only users. Bcrypt cannot match anything against
// this string, so local /auth/login is impossible for these accounts. When
// AUTH_LOCAL_ENABLED=false this column will be dropped entirely (cleanup phase).
const OIDC_SENTINEL_PASSWORD_HASH = '!oidc-only:no-local-password';

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

  createFromOidc(input: CreateFromOidcInput): User {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const username = this.uniqueUsername(input.username);
    this.db
      .prepare(
        `INSERT INTO users (id, display_name, username, password_hash, totp_confirmed,
                            email, kc_subject, created_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .run(
        id,
        input.displayName ?? username,
        username,
        OIDC_SENTINEL_PASSWORD_HASH,
        input.email,
        input.kcSubject,
        now
      );
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

  findByEmail(email: string): User | undefined {
    return this.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(email) as User | undefined;
  }

  findByKcSubject(kcSubject: string): User | undefined {
    return this.db
      .prepare('SELECT * FROM users WHERE kc_subject = ?')
      .get(kcSubject) as User | undefined;
  }

  linkKcSubject(userId: string, kcSubject: string, email?: string): void {
    if (email !== undefined) {
      this.db
        .prepare('UPDATE users SET kc_subject = ?, email = COALESCE(email, ?) WHERE id = ?')
        .run(kcSubject, email, userId);
    } else {
      this.db
        .prepare('UPDATE users SET kc_subject = ? WHERE id = ?')
        .run(kcSubject, userId);
    }
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

  delete(id: string): void {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  private uniqueUsername(base: string): string {
    const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 60) || `user_${crypto.randomUUID().slice(0, 8)}`;
    if (!this.findByUsername(cleaned)) return cleaned;
    for (let suffix = 2; suffix < 1000; suffix++) {
      const candidate = `${cleaned}_${suffix}`;
      if (!this.findByUsername(candidate)) return candidate;
    }
    return `${cleaned}_${crypto.randomUUID().slice(0, 8)}`;
  }
}
