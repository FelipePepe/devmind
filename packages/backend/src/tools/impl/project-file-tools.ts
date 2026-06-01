import { z } from 'zod';
import type { ToolDef } from '../types.js';
import type { ProjectFilesRepo } from '../../db/repos/project-files.js';
import { detectLanguage } from '../../db/repos/project-files.js';

export function createProjectFileTools(repo: ProjectFilesRepo): ToolDef[] {
  const writeProjectFile: ToolDef = {
    name: 'write_project_file',
    description:
      'Write or update a file in the current project. Use this to generate app code, HTML, CSS, JS, or any other project file. The file is stored and immediately served in the preview.',
    safety: 'write',
    inputSchema: z.object({
      path: z.string().trim().min(1),
      content: z.string(),
    }),
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to project root (e.g. "index.html", "src/App.tsx", "styles.css")',
        },
        content: {
          type: 'string',
          description: 'Complete file content to write',
        },
      },
      required: ['path', 'content'],
    },
    execute: async (args, ctx) => {
      const path = String(args['path'] ?? '').trim();
      const content = String(args['content'] ?? '');
      if (!path) return 'Error: path is required';
      if (!ctx.projectId) return 'Error: no active project';
      const language = detectLanguage(path);
      repo.upsert(ctx.projectId, path, content, language);
      return `File written: ${path} (${content.length} chars, language: ${language})`;
    },
  };

  const readProjectFile: ToolDef = {
    name: 'read_project_file',
    description: 'Read the content of a file in the current project.',
    safety: 'read',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to project root',
        },
      },
      required: ['path'],
    },
    execute: async (args, ctx) => {
      const path = String(args['path'] ?? '').trim();
      if (!path) return 'Error: path is required';
      if (!ctx.projectId) return 'Error: no active project';
      const file = repo.findByPath(ctx.projectId, path);
      if (!file) return `File not found: ${path}`;
      return file.content;
    },
  };

  const listProjectFiles: ToolDef = {
    name: 'list_project_files',
    description: 'List all files in the current project.',
    safety: 'read',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    execute: async (_args, ctx) => {
      if (!ctx.projectId) return 'Error: no active project';
      const files = repo.findByProject(ctx.projectId);
      if (files.length === 0) return 'No files in project yet.';
      return files.map((f) => `${f.path} (${f.language}, ${f.content.length} chars)`).join('\n');
    },
  };

  return [writeProjectFile, readProjectFile, listProjectFiles];
}
