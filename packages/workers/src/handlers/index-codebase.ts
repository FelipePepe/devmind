import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import pino from 'pino';
import { chunkText } from '../vector/chunker.js';
import { embedTexts } from '../vector/embed-client.js';
import { VectorIndexStore } from '../vector/index-store.js';
import type { JobQueueClient } from '../jobs.js';

const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

export interface IndexCodebasePayload {
  repoPath: string;
  sessionId: string;
}

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

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function indexCodebase(
  payload: IndexCodebasePayload,
  jobs: JobQueueClient,
  jobId: string
): Promise<void> {
  const vectorDbPath = process.env['VECTOR_DB_PATH'];
  if (!vectorDbPath) throw new Error('VECTOR_DB_PATH is not set');

  const ollamaBaseUrl = process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434';
  const embedModel = process.env['OLLAMA_EMBED_MODEL'] ?? 'nomic-embed-text';

  const store = new VectorIndexStore(
    join(vectorDbPath, 'chunks.db'),
    join(vectorDbPath, 'index.hnsw')
  );
  await store.init();

  const files = collectFiles(payload.repoPath, ['.ts', '.tsx', '.js', '.jsx']);
  logger.info({ count: files.length, repoPath: payload.repoPath }, 'Collected files');

  const storedHashes = store.getFileHashes();
  const currentFilePaths = new Set(files);

  // Delete chunks for files no longer present
  for (const storedPath of storedHashes.keys()) {
    if (!currentFilePaths.has(storedPath)) {
      logger.info({ file: storedPath }, 'File removed — deleting chunks');
      store.deleteChunksByFile(storedPath);
    }
  }

  let indexed = 0;
  let skipped = 0;

  for (const filePath of files) {
    let content: string;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      logger.warn({ file: filePath }, 'Unreadable file — skipping');
      continue;
    }

    const fileHash = sha256(content);
    if (storedHashes.get(filePath) === fileHash) {
      skipped++;
      continue;
    }

    // Remove stale chunks for changed file
    if (storedHashes.has(filePath)) {
      store.deleteChunksByFile(filePath);
    }

    const chunks = chunkText(content, filePath);
    if (chunks.length === 0) continue;

    try {
      const embeddings = await embedTexts(
        chunks.map((c) => c.text),
        { baseUrl: ollamaBaseUrl, model: embedModel }
      );
      store.addChunks(chunks, embeddings, fileHash);
      indexed++;
      logger.info({ file: filePath, chunks: chunks.length }, 'Indexed file');
    } catch (err) {
      logger.warn({ err, file: filePath }, 'Embed failed — skipping file');
    }
  }

  logger.info({ indexed, skipped }, 'Indexing complete');

  if (store.shouldRebuild()) {
    logger.info('Delete ratio exceeded threshold — full index rebuild not needed for initial build');
  }

  store.saveIndex();
  jobs.updateStatus(jobId, 'done');
}
