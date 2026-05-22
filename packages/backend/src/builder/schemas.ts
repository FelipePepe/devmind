import { z } from 'zod';

export const ServiceKindSchema = z.enum(['frontend', 'backend', 'worker']);
export const ServiceStatusSchema = z.enum(['planned', 'generating', 'ready', 'failed', 'disabled']);
export const ApiRouteMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
export const DbMigrationStatusSchema = z.enum(['draft', 'generated', 'applied', 'failed']);
export const ValidationStatusSchema = z.enum(['pending', 'pass', 'fail']);

export const SafeRootPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine((value) => !value.startsWith('/') && !value.split('/').includes('..'), {
    message: 'rootPath must be relative and stay inside the project',
  });

export const SafeHandlerPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine((value) => !value.startsWith('/') && !value.split('/').includes('..'), {
    message: 'handlerPath must be relative and stay inside the project',
  });

export const ManifestSchema = z.object({
  version: z.number().int().positive().optional(),
  appType: z.string().trim().min(1).max(80).optional(),
  stack: z.record(z.unknown()).optional(),
  commands: z.record(z.unknown()).optional(),
  entrypoints: z.record(z.unknown()).optional(),
});

export const CreateServiceSchema = z.object({
  kind: ServiceKindSchema,
  name: z.string().trim().min(1).max(120),
  rootPath: SafeRootPathSchema,
  runtime: z.string().trim().min(1).max(120),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  status: ServiceStatusSchema.optional(),
  config: z.record(z.unknown()).optional(),
});

export const UpdateServiceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  rootPath: SafeRootPathSchema.optional(),
  runtime: z.string().trim().min(1).max(120).optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  status: ServiceStatusSchema.optional(),
  config: z.record(z.unknown()).optional(),
});

export const ApiRouteSchema = z.object({
  serviceId: z.string().trim().min(1).nullable().optional(),
  method: ApiRouteMethodSchema,
  path: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .regex(/^\/[a-z0-9\-/_:]*$/i, 'path must start with "/" and contain URL-safe characters'),
  handlerPath: SafeHandlerPathSchema,
  requestSchema: z.record(z.unknown()).optional(),
  responseSchema: z.record(z.unknown()).optional(),
});

export const DbSchemaSchema = z.object({
  engine: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(120),
  schema: z.record(z.unknown()),
});

export const EnvVarSchema = z.object({
  serviceId: z.string().trim().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(120).regex(/^[A-Z][A-Z0-9_]*$/, 'name must be SCREAMING_SNAKE_CASE'),
  required: z.boolean().optional(),
  secretRef: z.string().trim().min(1).max(240).nullable().optional(),
  defaultValue: z.string().max(2000).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});

export const ValidationReportSchema = z.object({
  runId: z.string().trim().min(1).nullable().optional(),
  status: ValidationStatusSchema,
  checks: z.array(z.unknown()).optional(),
  logExcerpt: z.string().max(4000).nullable().optional(),
});
