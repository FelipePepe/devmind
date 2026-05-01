import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { config } from '../config.js';
import { generateToken, verifyToken } from './signed-url.js';
import type { ArtifactsRepo, Artifact } from '../db/repos/artifacts.js';
import type { ReadStream } from 'node:fs';

export interface UploadResult {
  artifact: Artifact;
  signedUrl: string;
}

export class StorageService {
  constructor(private artifacts: ArtifactsRepo) {}

  async upload(
    userId: string,
    sessionId: string | null,
    filename: string,
    mimeTypeRaw: string,
    buffer: Buffer
  ): Promise<UploadResult> {
    // Sanitize filename
    const safe = basename(filename);
    if (!safe || safe.includes('\0') || safe.includes('/')) {
      throw Object.assign(new Error('Invalid filename'), { status: 400 });
    }

    // Enforce upload size limit
    if (buffer.length > config.MAX_UPLOAD_BYTES) {
      throw Object.assign(
        new Error(`File exceeds maximum size of ${config.MAX_UPLOAD_BYTES} bytes`),
        { status: 400 }
      );
    }

    // Detect MIME from content; discard client-supplied Content-Type
    const detected = await fileTypeFromBuffer(buffer);
    const mimeType = detected?.mime ?? 'application/octet-stream';
    void mimeTypeRaw;

    const artifactId = crypto.randomUUID();
    const dir = join(config.STORAGE_BASE_PATH, userId, artifactId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, safe), buffer);

    const artifact = this.artifacts.create({
      userId,
      sessionId,
      filename: safe,
      mimeType,
      sizeBytes: buffer.length,
      storagePath: join(dir, safe),
    });

    const signedUrl = this.generateSignedUrl(userId, artifact.id);
    return { artifact, signedUrl };
  }

  download(userId: string, artifactId: string, rawToken: string): ReadStream {
    const artifact = this.artifacts.findById(userId, artifactId);
    if (!artifact) {
      throw Object.assign(new Error('Not found'), { status: 404 });
    }

    if (!verifyToken(rawToken, artifactId, userId)) {
      throw Object.assign(new Error('Invalid or expired token'), { status: 403 });
    }

    return createReadStream(artifact.storage_path);
  }

  generateSignedUrl(userId: string, artifactId: string): string {
    const expiresAt = Date.now() + config.SIGNED_URL_TTL_MS;
    const token = generateToken(artifactId, userId, expiresAt);
    this.artifacts.updateSignedUrl(artifactId, token, new Date(expiresAt).toISOString());
    return `/api/artifacts/${artifactId}/download?userId=${encodeURIComponent(userId)}&token=${encodeURIComponent(token)}`;
  }

  list(userId: string, sessionId?: string): Artifact[] {
    if (sessionId) return this.artifacts.findBySession(userId, sessionId);
    return this.artifacts.findByUser(userId);
  }
}
