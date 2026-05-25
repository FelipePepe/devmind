import { z } from 'zod';
import type { MessagesRepo } from '../../db/repos/messages.js';
import type { SessionsRepo } from '../../db/repos/sessions.js';
import type { TasksRepo } from '../../db/repos/tasks.js';
import type { StorageService } from '../../storage/storage.js';
import type { ToolDef } from '../types.js';

export function createSessionHistoryTool(
  messages: MessagesRepo,
  sessions: SessionsRepo,
  userId: string
): ToolDef {
  return {
    name: 'session_history',
    description: 'Return the message history for a session',
    safety: 'read',
    parameters: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: { type: 'string', description: 'Session ID to fetch history for' },
        limit: { type: 'number', description: 'Max messages to return (default 20)' },
      },
    },
    async execute({ sessionId, limit }) {
      if (typeof sessionId !== 'string') return JSON.stringify({ error: 'sessionId required' });
      const session = sessions.findById(userId, sessionId);
      if (!session) return JSON.stringify({ error: 'Session not found' });
      const msgs = messages.findBySession(sessionId, typeof limit === 'number' ? limit : 20);
      return JSON.stringify(msgs);
    },
  };
}

export function createTaskUpdateTool(tasks: TasksRepo): ToolDef {
  return {
    name: 'task_update',
    description: 'Update the status of a task',
    safety: 'write',
    inputSchema: z.object({
      taskId: z.string().min(1),
      status: z.enum(['pending', 'in_progress', 'done', 'blocked']),
    }),
    parameters: {
      type: 'object',
      required: ['taskId', 'status'],
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'done', 'blocked'],
          description: 'New status',
        },
      },
    },
    async execute({ taskId, status }) {
      if (typeof taskId !== 'string' || typeof status !== 'string') {
        return JSON.stringify({ error: 'taskId and status required' });
      }
      const validStatuses = ['pending', 'in_progress', 'done', 'blocked'];
      if (!validStatuses.includes(status)) {
        return JSON.stringify({ error: `Invalid status: ${status}` });
      }
      tasks.updateStatus(taskId, status as 'pending' | 'in_progress' | 'done' | 'blocked');
      return JSON.stringify({ ok: true, taskId, status });
    },
  };
}

export function createArtifactListTool(storage: StorageService, userId: string): ToolDef {
  return {
    name: 'artifact_list',
    description: 'List artifacts for the current user, optionally filtered by session',
    safety: 'read',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Filter artifacts by session ID' },
      },
    },
    async execute({ sessionId }) {
      const artifacts = storage.list(userId, typeof sessionId === 'string' ? sessionId : undefined);
      return JSON.stringify(artifacts);
    },
  };
}
