export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'DevMind API',
    version: '1.0.0',
    description: 'Local AI coding assistant — project-first builder with agent chat.',
  },
  servers: [{ url: '/api', description: 'DevMind backend' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: { error: { type: 'string' }, details: {} },
      },
      Project: {
        type: 'object',
        required: ['id', 'name', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      Health: {
        type: 'object',
        required: ['ok', 'db', 'ollama', 'workers', 'timestamp'],
        properties: {
          ok: { type: 'boolean' },
          db: { type: 'string', enum: ['ok', 'error'] },
          ollama: { type: 'string', enum: ['ok', 'error'] },
          workers: {
            type: 'object',
            properties: {
              pending: { type: 'integer' },
              processing: { type: 'integer' },
              failed: { type: 'integer' },
              lag_ms: { type: 'integer' },
            },
          },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      ProjectFile: {
        type: 'object',
        required: ['id', 'path', 'content'],
        properties: {
          id: { type: 'string' },
          path: { type: 'string' },
          content: { type: 'string' },
          language: { type: 'string', nullable: true },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      Snapshot: {
        type: 'object',
        required: ['id', 'project_id', 'label', 'created_at'],
        properties: {
          id: { type: 'string' },
          project_id: { type: 'string' },
          label: { type: 'string' },
          trigger: { type: 'string' },
          parent_id: { type: 'string', nullable: true },
          metadata: { type: 'object', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        security: [],
        responses: {
          200: { description: 'System healthy', content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } } },
          503: { description: 'DB unavailable', content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } } },
        },
      },
    },
    '/metrics': {
      get: {
        tags: ['System'],
        summary: 'Prometheus metrics',
        security: [],
        responses: { 200: { description: 'Prometheus text format', content: { 'text/plain': {} } } },
      },
    },

    '/projects': {
      get: {
        tags: ['Projects'],
        summary: 'List projects',
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Project' } } } } },
        },
      },
      post: {
        tags: ['Projects'],
        summary: 'Create project',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, description: { type: 'string' } } } } },
        },
        responses: {
          201: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Project' } } } },
          400: { description: 'Bad request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/projects/import': {
      post: {
        tags: ['Projects'],
        summary: 'Import project from export bundle',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['format', 'version', 'project'], properties: { format: { type: 'string', enum: ['devmind-export'] }, version: { type: 'string' }, project: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string', nullable: true } } } } } } },
        },
        responses: {
          201: { description: 'Imported', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } } } } },
          400: { description: 'Invalid bundle', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/projects/{id}': {
      get: {
        tags: ['Projects'],
        summary: 'Get project',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Project' } } } },
          404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      patch: {
        tags: ['Projects'],
        summary: 'Update project',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string', nullable: true } } } } } },
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Project' } } } },
          404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      delete: {
        tags: ['Projects'],
        summary: 'Delete project',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Deleted' }, 404: { description: 'Not found' } },
      },
    },
    '/projects/{id}/export': {
      get: {
        tags: ['Projects'],
        summary: 'Export project as JSON bundle',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'JSON export file', content: { 'application/json': {} } } },
      },
    },
    '/projects/{id}/files': {
      get: {
        tags: ['Files'],
        summary: 'List project files',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ProjectFile' } } } } } },
      },
    },
    '/projects/{id}/files/{path}': {
      get: {
        tags: ['Files'],
        summary: 'Get file by path',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'path', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/ProjectFile' } } } },
          404: { description: 'Not found' },
        },
      },
      put: {
        tags: ['Files'],
        summary: 'Create or update file',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'path', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['content'], properties: { content: { type: 'string' }, language: { type: 'string' } } } } } },
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/ProjectFile' } } } } },
      },
      delete: {
        tags: ['Files'],
        summary: 'Delete file',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'path', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 204: { description: 'Deleted' } },
      },
    },
    '/projects/{id}/snapshots': {
      get: {
        tags: ['Snapshots'],
        summary: 'List snapshots',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Snapshot' } } } } } },
      },
      post: {
        tags: ['Snapshots'],
        summary: 'Create manual snapshot',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { label: { type: 'string' } } } } } },
        responses: { 201: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Snapshot' } } } } },
      },
    },
    '/projects/{id}/snapshots/{snapshotId}/restore': {
      post: {
        tags: ['Snapshots'],
        summary: 'Restore project to snapshot',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'snapshotId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'OK' }, 404: { description: 'Not found' } },
      },
    },
    '/chat': {
      post: {
        tags: ['Chat'],
        summary: 'Send agent message (SSE stream)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['message'], properties: { message: { type: 'string' }, sessionId: { type: 'string' }, projectId: { type: 'string' } } } } },
        },
        responses: { 200: { description: 'SSE stream of agent events', content: { 'text/event-stream': {} } } },
      },
    },
  },
} as const;
