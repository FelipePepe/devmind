/**
 * Utilities for materializing project DB files to disk and creating
 * git archives / pushing to a remote.
 */

import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export interface ProjectFileRow {
  path: string;
  content: string;
}

/** Write project files to a temp directory. Returns the temp dir path. */
export function materializeToTemp(files: ProjectFileRow[], projectName: string): string {
  const dir = join(tmpdir(), `devmind-git-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });

  for (const f of files) {
    const abs = join(dir, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content, 'utf8');
  }

  // Basic .gitignore
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\ndist/\n.env\n*.local\n');

  return dir;
}

/** Create a tar.gz archive of the materialized directory. Returns raw buffer. */
export function createTarGz(dir: string): Buffer {
  const out = join(tmpdir(), `devmind-archive-${randomUUID()}.tar.gz`);
  execFileSync('tar', ['-czf', out, '-C', dir, '.']);
  const buf = readFileSync(out);
  rmSync(out, { force: true });
  return buf;
}

/** Initialize a git repo, commit all files, push to remote. Returns commit hash. */
export function gitPush(opts: {
  dir: string;
  projectName: string;
  remoteUrl: string;
  branch?: string;
  authorName?: string;
  authorEmail?: string;
}): string {
  const { dir, projectName, remoteUrl, branch = 'main', authorName = 'DevMind', authorEmail = 'devmind@local' } = opts;

  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: authorName,
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_COMMITTER_NAME: authorName,
    GIT_COMMITTER_EMAIL: authorEmail,
    GIT_TERMINAL_PROMPT: '0',
  };

  execFileSync('git', ['init', '-b', branch], { cwd: dir, env });
  execFileSync('git', ['add', '-A'], { cwd: dir, env });
  execFileSync('git', ['commit', '-m', `DevMind: ${projectName}`], { cwd: dir, env });
  execFileSync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: dir, env });
  execFileSync('git', ['push', '-u', 'origin', branch, '--force'], { cwd: dir, env, timeout: 30000 });

  const hash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, env }).toString().trim();
  return hash;
}

export function cleanupTemp(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* non-fatal */ }
}
