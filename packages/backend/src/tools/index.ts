import { ToolRegistry } from './registry.js';
import { fileReadTool } from './impl/file-read.js';
import { fileListTool } from './impl/file-list.js';
import { searchCodeTool } from './impl/search-code.js';
import { runCommandTool } from './impl/run-command.js';
import { vectorSearchTool } from './impl/vector-search.js';
import {
  createSessionHistoryTool,
  createTaskUpdateTool,
  createArtifactListTool,
} from './impl/session-tools.js';
import { createProjectFileTools } from './impl/project-file-tools.js';
import type { SessionsRepo } from '../db/repos/sessions.js';
import type { MessagesRepo } from '../db/repos/messages.js';
import type { TasksRepo } from '../db/repos/tasks.js';
import type { StorageService } from '../storage/storage.js';
import type { ProjectFilesRepo } from '../db/repos/project-files.js';

export interface ToolServices {
  sessions: SessionsRepo;
  messages: MessagesRepo;
  tasks: TasksRepo;
  storage: StorageService;
  projectFiles?: ProjectFilesRepo;
}

export function createToolRegistry(services: ToolServices, userId: string): ToolRegistry {
  const registry = new ToolRegistry().register(
    fileReadTool,
    fileListTool,
    searchCodeTool,
    runCommandTool,
    vectorSearchTool,
    createSessionHistoryTool(services.messages, services.sessions, userId),
    createTaskUpdateTool(services.tasks),
    createArtifactListTool(services.storage, userId)
  );

  if (services.projectFiles) {
    registry.register(...createProjectFileTools(services.projectFiles));
  }

  return registry;
}

export { ToolRegistry } from './registry.js';
export { ToolExecutor } from './executor.js';
export type { ToolDef, ToolContext } from './types.js';
