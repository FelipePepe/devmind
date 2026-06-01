import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ProjectFilesRepo, detectLanguage, getMimeType } from './project-files.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE project_files (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      project_id  TEXT NOT NULL,
      path        TEXT NOT NULL,
      content     TEXT NOT NULL DEFAULT '',
      language    TEXT NOT NULL DEFAULT 'plaintext',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_project_files_path ON project_files(project_id, path);
  `);
  return db;
}

test('detectLanguage maps known extensions and falls back to plaintext', () => {
  assert.equal(detectLanguage('src/index.ts'), 'typescript');
  assert.equal(detectLanguage('app.tsx'), 'typescript');
  assert.equal(detectLanguage('main.py'), 'python');
  assert.equal(detectLanguage('README.md'), 'markdown');
  assert.equal(detectLanguage('config'), 'plaintext');
  assert.equal(detectLanguage('weird.unknownext'), 'plaintext');
});

test('getMimeType returns charset for text formats and falls back to text/plain', () => {
  assert.equal(getMimeType('page.html'), 'text/html; charset=utf-8');
  assert.equal(getMimeType('icon.svg'), 'image/svg+xml; charset=utf-8');
  assert.equal(getMimeType('data.json'), 'application/json; charset=utf-8');
  assert.equal(getMimeType('binary.bin'), 'text/plain; charset=utf-8');
});

test('upsert inserts a new file with auto-detected language', () => {
  const repo = new ProjectFilesRepo(freshDb());
  const file = repo.upsert('p1', 'src/app.ts', 'export const x = 1;');
  assert.equal(file.project_id, 'p1');
  assert.equal(file.path, 'src/app.ts');
  assert.equal(file.content, 'export const x = 1;');
  assert.equal(file.language, 'typescript');
});

test('upsert updates content and language on the same path without duplicating rows', () => {
  const db = freshDb();
  const repo = new ProjectFilesRepo(db);
  repo.upsert('p1', 'src/app.ts', 'v1');
  repo.upsert('p1', 'src/app.ts', 'v2', 'typescript');
  const all = repo.findByProject('p1');
  assert.equal(all.length, 1);
  assert.equal(all[0]!.content, 'v2');
});

test('upsert keeps an explicit language override', () => {
  const repo = new ProjectFilesRepo(freshDb());
  const file = repo.upsert('p1', 'config', 'KEY=value', 'shell');
  assert.equal(file.language, 'shell');
});

test('findByProject returns files in path order and ignores other projects', () => {
  const repo = new ProjectFilesRepo(freshDb());
  repo.upsert('p1', 'src/b.ts', 'b');
  repo.upsert('p1', 'src/a.ts', 'a');
  repo.upsert('p2', 'src/a.ts', 'other');

  const files = repo.findByProject('p1');
  assert.equal(files.length, 2);
  assert.deepEqual(files.map((f) => f.path), ['src/a.ts', 'src/b.ts']);
});

test('findByPath returns undefined when missing', () => {
  const repo = new ProjectFilesRepo(freshDb());
  assert.equal(repo.findByPath('p1', 'nope.ts'), undefined);
});

test('delete removes only the targeted file', () => {
  const repo = new ProjectFilesRepo(freshDb());
  repo.upsert('p1', 'a.ts', 'a');
  repo.upsert('p1', 'b.ts', 'b');
  repo.delete('p1', 'a.ts');

  assert.equal(repo.findByPath('p1', 'a.ts'), undefined);
  assert.equal(repo.findByProject('p1').length, 1);
});
