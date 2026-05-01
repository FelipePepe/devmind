import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { MessagesRepo } from '../db/repos/messages.js';
import type { SessionsRepo } from '../db/repos/sessions.js';

export function createSessionHistoryTool(
  messages: MessagesRepo,
  sessions: SessionsRepo,
  userId: string
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'session_history',
    description: 'Return the message history for a session',
    schema: z.object({
      sessionId: z.string().describe('Session ID to fetch history for'),
      limit: z.number().int().positive().default(20).describe('Max messages to return'),
    }),
    func: async ({ sessionId, limit }) => {
      // Ownership check
      const session = sessions.findById(userId, sessionId);
      if (!session) return JSON.stringify({ error: 'Session not found' });
      const msgs = messages.findBySession(sessionId, limit);
      return JSON.stringify(msgs);
    },
  });
}
