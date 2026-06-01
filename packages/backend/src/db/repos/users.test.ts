import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { UsersRepo } from './users.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id             TEXT PRIMARY KEY,
      display_name   TEXT NOT NULL,
      username       TEXT NOT NULL UNIQUE,
      password_hash  TEXT NOT NULL,
      totp_secret    TEXT,
      totp_confirmed INTEGER NOT NULL DEFAULT 0,
      is_admin       INTEGER NOT NULL DEFAULT 0,
      email          TEXT,
      kc_subject     TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_users_kc_subject ON users(kc_subject) WHERE kc_subject IS NOT NULL;
    CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
  `);
  return db;
}

test('createFromOidc inserts a new user with kc_subject + email and sentinel password hash', () => {
  const db = freshDb();
  const repo = new UsersRepo(db);

  const user = repo.createFromOidc({
    kcSubject: 'kc-1',
    email: 'alice@example.com',
    username: 'alice',
  });

  assert.equal(user.username, 'alice');
  assert.equal(user.email, 'alice@example.com');
  assert.equal(user.kc_subject, 'kc-1');
  assert.equal(user.totp_confirmed, 1);
  assert.ok(user.password_hash.startsWith('!oidc-only'));
});

test('createFromOidc disambiguates colliding usernames', () => {
  const db = freshDb();
  const repo = new UsersRepo(db);

  const first = repo.createFromOidc({ kcSubject: 'kc-a', email: 'a@example.com', username: 'bob' });
  const second = repo.createFromOidc({ kcSubject: 'kc-b', email: 'b@example.com', username: 'bob' });

  assert.equal(first.username, 'bob');
  assert.equal(second.username, 'bob_2');
});

test('findByKcSubject and findByEmail locate the right user', () => {
  const db = freshDb();
  const repo = new UsersRepo(db);
  repo.createFromOidc({ kcSubject: 'kc-x', email: 'x@example.com', username: 'xavier' });

  assert.ok(repo.findByKcSubject('kc-x'));
  assert.ok(repo.findByEmail('x@example.com'));
  assert.equal(repo.findByKcSubject('missing'), undefined);
});

test('linkKcSubject attaches kc_subject to an existing local user (email-based linking)', () => {
  const db = freshDb();
  const repo = new UsersRepo(db);

  // Existing local-only user (no kc_subject, no email yet — pre-migration shape).
  const existing = repo.create({
    displayName: 'Charlie',
    username: 'charlie',
    passwordHash: 'h',
    totpSecret: 's',
  });

  repo.linkKcSubject(existing.id, 'kc-charlie', 'charlie@example.com');
  const linked = repo.findById(existing.id)!;
  assert.equal(linked.kc_subject, 'kc-charlie');
  assert.equal(linked.email, 'charlie@example.com');
  assert.equal(repo.findByKcSubject('kc-charlie')?.id, existing.id);
});

test('linkKcSubject does not overwrite an existing email', () => {
  const db = freshDb();
  const repo = new UsersRepo(db);

  const user = repo.createFromOidc({
    kcSubject: 'kc-old',
    email: 'original@example.com',
    username: 'doris',
  });

  repo.linkKcSubject(user.id, 'kc-new', 'changed@example.com');
  const after = repo.findById(user.id)!;
  assert.equal(after.kc_subject, 'kc-new');
  // email is preserved via COALESCE
  assert.equal(after.email, 'original@example.com');
});
