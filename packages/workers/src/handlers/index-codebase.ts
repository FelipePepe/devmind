import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readdirSync, statSync, readFileSync, realpathSync } from 'node:fs';
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

function collectFiles(dir: string, exts: string[], realRoot: string, visited = new Set<string>()): string[] {
  const results: string[] = [];
  try {
    const realDir = realpathSync(dir);
    if (visited.has(realDir)) return results;
    if (!realDir.startsWith(realRoot + '/') && realDir !== realRoot) return results;
    visited.add(realDir);
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
        results.push(...collectFiles(fullPath, exts, realRoot, visited));
      } else if (exts.some((ext) => entry.endsWith(ext))) {
        try {
          const realFile = realpathSync(fullPath);
          if (realFile.startsWith(realRoot + '/') || realFile === realRoot) {
            results.push(fullPath);
          }
        } catch {
          // skip unresolvable symlinks
        }
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
  try {
    await store.init();
    const realRepoRoot = realpathSync(payload.repoPath);
    const files = collectFiles(payload.repoPath, ['.ts', '.tsx', '.js', '.jsx'], realRepoRoot);
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

    // Cache embeddings from this run to avoid redundant re-embedding during rebuild
    const embeddingCache = new Map<string, {
      chunks: ReturnType<typeof chunkText>;
      embeddings: number[][];
      fileHash: string;
    }>();

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
        embeddingCache.set(filePath, { chunks, embeddings, fileHash });
        indexed++;
        logger.info({ file: filePath, chunks: chunks.length }, 'Indexed file');
      } catch (err) {
        logger.warn({ err, file: filePath }, 'Embed failed — skipping file');
      }
    }

    logger.info({ indexed, skipped }, 'Indexing complete');

    if (store.shouldRebuild()) {
      logger.info('HNSW delete ratio exceeded threshold — triggering full rebuild');
      const allFilePaths = store.getAllFilePaths();
      const rebuildChunks: ReturnType<typeof chunkText> = [];
      const rebuildEmbeddings: number[][] = [];
      const rebuildFileHashes = new Map<string, string>();

      for (const filePath of allFilePaths) {
        // Reuse embeddings computed in the main loop to avoid redundant Ollama calls
        const cached = embeddingCache.get(filePath);
        if (cached) {
          rebuildChunks.push(...cached.chunks);
          rebuildEmbeddings.push(...cached.embeddings);
          rebuildFileHashes.set(filePath, cached.fileHash);
          continue;
        }

        let rebuildContent: string;
        try {
          rebuildContent = readFileSync(filePath, 'utf8');
        } catch {
          logger.warn({ file: filePath }, 'Unreadable during rebuild — skipping');
          continue;
        }
        const chunks = chunkText(rebuildContent, filePath);
        if (chunks.length === 0) continue;
        try {
          const embeddings = await embedTexts(
            chunks.map((c) => c.text),
            { baseUrl: ollamaBaseUrl, model: embedModel }
          );
          rebuildChunks.push(...chunks);
          rebuildEmbeddings.push(...embeddings);
          rebuildFileHashes.set(filePath, sha256(rebuildContent));
        } catch (err) {
          logger.warn({ err, file: filePath }, 'Embed failed during rebuild — skipping file');
        }
      }

      store.rebuildIndex(rebuildChunks, rebuildEmbeddings, rebuildFileHashes);
      logger.info({ chunkCount: rebuildChunks.length }, 'HNSW index rebuilt successfully');
    }

    store.saveIndex();
    jobs.updateStatus(jobId, 'done');
  } catch (err) {
    logger.error({ err, jobId }, 'indexCodebase failed — preserving last good on-disk index');
    jobs.updateStatus(jobId, 'failed');
  }
}
