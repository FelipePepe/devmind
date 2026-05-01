import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { StorageService } from '../storage/storage.js';

export function createArtifactUploadTool(storage: StorageService, userId: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'artifact_upload',
    description: 'Upload a file artifact (base64-encoded) and receive a signed URL',
    schema: z.object({
      sessionId: z.string().optional().describe('Session to associate artifact with'),
      filename: z.string().describe('Filename for the artifact'),
      mimeType: z.string().describe('MIME type hint (actual type detected from content)'),
      base64: z.string().describe('Base64-encoded file content'),
    }),
    func: async ({ sessionId, filename, mimeType, base64 }) => {
      try {
        const buffer = Buffer.from(base64, 'base64');
        const result = await storage.upload(userId, sessionId ?? null, filename, mimeType, buffer);
        return JSON.stringify(result);
      } catch (err) {
        const e = err as { message: string };
        return JSON.stringify({ error: e.message });
      }
    },
  });
}
