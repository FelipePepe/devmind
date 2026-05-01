import type Database from 'better-sqlite3';
import { getDb } from '../db.js';
import type { JobQueueClient } from '../jobs.js';

export interface IndexCodebasePayload {
  repoPath: string;
  sessionId: string;
}

export async function indexCodebase(
  payload: IndexCodebasePayload,
  jobs: JobQueueClient,
  jobId: string
): Promise<void> {
  const db: Database.Database = getDb();

  // Read TypeScript/JavaScript files from repoPath
  const { readdirSync, statSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');

  function collectFiles(dir: string, exts: string[]): string[] {
    const results: string[] = [];
    try {
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
          results.push(...collectFiles(fullPath, exts));
        } else if (exts.some((ext) => entry.endsWith(ext))) {
          results.push(fullPath);
        }
      }
    } catch {
      // skip unreadable dirs
    }
    return results;
  }

  const files = collectFiles(payload.repoPath, ['.ts', '.tsx', '.js', '.jsx']);

  // Chunk files into ~1000 char segments
  const chunks: string[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf8');
      const chunkSize = 1000;
      for (let i = 0; i < content.length; i += chunkSize) {
        chunks.push(`${file}:\n${content.slice(i, i + chunkSize)}`);
      }
    } catch {
      // skip unreadable files
    }
  }

  // Store chunk count in job payload for reference
  db.prepare('UPDATE job_queue SET payload = ? WHERE id = ?').run(
    JSON.stringify({ ...payload, chunkCount: chunks.length }),
    jobId
  );

  // hnswlib-node indexing would go here in a full implementation
  // For now: mark as done with chunk count logged
  jobs.updateStatus(jobId, 'done');
}
