import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { StorageService } from '../storage/storage.js';

export function createArtifactListTool(storage: StorageService, userId: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'artifact_list',
    description: 'List artifacts for the current user, optionally filtered by session',
    schema: z.object({
      sessionId: z.string().optional().describe('Filter artifacts by session ID'),
    }),
    func: async ({ sessionId }) => {
      const artifacts = storage.list(userId, sessionId);
      return JSON.stringify(artifacts);
    },
  });
}
