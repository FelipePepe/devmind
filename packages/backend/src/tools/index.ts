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
import { createProjectStructureTools } from './impl/project-structure-tools.js';
import type { SessionsRepo } from '../db/repos/sessions.js';
import type { MessagesRepo } from '../db/repos/messages.js';
import type { TasksRepo } from '../db/repos/tasks.js';
import type { StorageService } from '../storage/storage.js';
import type { ProjectFilesRepo } from '../db/repos/project-files.js';
import type { ProjectManifestsRepo } from '../db/repos/project-manifests.js';
import type { ProjectServicesRepo } from '../db/repos/project-services.js';
import type { ProjectApiRoutesRepo } from '../db/repos/project-api-routes.js';
import type { ProjectDbSchemasRepo, ProjectDbMigrationsRepo } from '../db/repos/project-database.js';
import type { ProjectEnvVarsRepo } from '../db/repos/project-env-vars.js';
import type { JobQueueClient } from '../workers/queue.js';
import type { ProjectSnapshotsRepo } from '../db/repos/project-snapshots.js';

export interface ToolServices {
  sessions: SessionsRepo;
  messages: MessagesRepo;
  tasks: TasksRepo;
  storage: StorageService;
  projectFiles?: ProjectFilesRepo;
  projectManifests?: ProjectManifestsRepo;
  projectServices?: ProjectServicesRepo;
  projectApiRoutes?: ProjectApiRoutesRepo;
  projectDbSchemas?: ProjectDbSchemasRepo;
  projectDbMigrations?: ProjectDbMigrationsRepo;
  projectEnvVars?: ProjectEnvVarsRepo;
  projectSnapshots?: ProjectSnapshotsRepo;
  jobs?: JobQueueClient;
}

export interface ToolRegistryOptions {
  projectBuilderOnly?: boolean;
}

export function createToolRegistry(
  services: ToolServices,
  userId: string,
  options: ToolRegistryOptions = {}
): ToolRegistry {
  const registry = new ToolRegistry();

  if (!options.projectBuilderOnly) {
    registry.register(
      fileReadTool,
      fileListTool,
      searchCodeTool,
      runCommandTool,
      vectorSearchTool,
      createSessionHistoryTool(services.messages, services.sessions, userId),
      createTaskUpdateTool(services.tasks),
      createArtifactListTool(services.storage, userId)
    );
  }

  if (services.projectFiles) {
    registry.register(...createProjectFileTools(services.projectFiles));
  }

  if (
    services.projectManifests &&
    services.projectServices &&
    services.projectApiRoutes &&
    services.projectDbSchemas &&
    services.projectDbMigrations &&
    services.projectEnvVars &&
    services.projectSnapshots &&
    services.jobs
  ) {
    registry.register(...createProjectStructureTools(
      services.projectManifests,
      services.projectServices,
      services.projectApiRoutes,
      services.projectDbSchemas,
      services.projectDbMigrations,
      services.projectEnvVars,
      services.projectSnapshots,
      services.jobs
    ));
  }

  return registry;
}

export { ToolRegistry } from './registry.js';
export { ToolExecutor } from './executor.js';
export type { ToolDef, ToolContext } from './types.js';
