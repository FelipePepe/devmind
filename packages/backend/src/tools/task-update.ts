import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { TasksRepo } from '../db/repos/tasks.js';
import type { TaskStatus } from '../db/repos/tasks.js';

const TaskStatusSchema = z.enum(['pending', 'in_progress', 'done', 'blocked']);

export function createTaskUpdateTool(tasks: TasksRepo): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'task_update',
    description: 'Update the status of a task',
    schema: z.object({
      taskId: z.string().describe('Task ID'),
      status: TaskStatusSchema.describe('New status'),
    }),
    func: async ({ taskId, status }) => {
      tasks.updateStatus(taskId, status as TaskStatus);
      return JSON.stringify({ ok: true, taskId, status });
    },
  });
}
