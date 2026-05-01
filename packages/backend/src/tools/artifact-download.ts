import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { StorageService } from '../storage/storage.js';

export function createArtifactDownloadTool(storage: StorageService, userId: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'artifact_download',
    description: 'Generate a fresh signed download URL for an artifact',
    schema: z.object({
      artifactId: z.string().describe('Artifact ID'),
    }),
    func: async ({ artifactId }) => {
      try {
        const signedUrl = storage.generateSignedUrl(userId, artifactId);
        return JSON.stringify({ signedUrl });
      } catch (err) {
        const e = err as { message: string };
        return JSON.stringify({ error: e.message });
      }
    },
  });
}
