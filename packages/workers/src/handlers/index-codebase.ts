import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readdirSync, statSync, readFileSync, realpathSync } from 'node:fs';
import { chunkText } from '../vector/chunker.js';
import { embedTexts } from '../vector/embed-client.js';
import { VectorIndexStore } from '../vector/index-store.js';
import type { JobQueueClient } from '../jobs.js';
import { logger } from '../logger.js';

export interface IndexCodebasePayload {
  repoPath: string;
  sessionId: string;
}

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.turbo']);

function collectFiles(dir: string, exts: string[], realRoot: string, visited = new Set<string>()): string[] {
  const results: string[] = [];
  try {
    const realDir = realpathSync(dir);
    if (visited.has(realDir)) return results;
    if (!realDir.startsWith(realRoot + '/') && realDir !== realRoot) return results;
    visited.add(realDir);
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(fullPath);
      } catch (err) {
        logger.warn({ file: fullPath, err }, 'statSync failed — skipping entry');
        continue;
      }
      if (stat.isDirectory() && !entry.startsWith('.') && !EXCLUDED_DIRS.has(entry)) {
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
  let rebuildDone = false;

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

    let rebuildHappened = false;
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

        // Load embeddings from DB for unchanged files to avoid re-embedding (FIX-5)
        const stored = store.getFileChunksAndEmbeddings(filePath);
        if (stored) {
          rebuildChunks.push(...stored.chunks);
          rebuildEmbeddings.push(...stored.embeddings);
          rebuildFileHashes.set(filePath, stored.fileHash);
          continue;
        }

        // Fall back to re-reading and re-embedding (legacy rows with empty blobs, or DB miss)
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
      rebuildDone = true;
      rebuildHappened = true;
      logger.info({ chunkCount: rebuildChunks.length }, 'HNSW index rebuilt successfully');
    }

    // Only persist the HNSW file if something actually changed (FIX-11)
    if (indexed > 0 || rebuildHappened) {
      store.saveIndex();
    }
    jobs.updateStatus(jobId, 'done');
  } catch (err) {
    logger.error({ err, jobId }, 'indexCodebase failed — preserving last good on-disk index');
    // If rebuild committed to DB but saveIndex() (or something after it) failed, force the next
    // run to rebuild so the on-disk HNSW file is brought back in sync with the DB (FIX-6).
    if (rebuildDone) {
      store.markRebuildNeeded();
      logger.warn({ jobId }, 'Rebuild completed but post-rebuild step failed — HNSW file may be stale, next run will rebuild');
    }
    jobs.updateStatus(jobId, 'failed');
  } finally {
    store.close();
  }
}
