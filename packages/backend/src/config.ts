import { z } from 'zod';

// NOTE: The following secrets MUST be provisioned in Infisical project devmind-pxgt:
//   VAPID_PUBLIC_KEY    — VAPID public key for Web Push
//   VAPID_PRIVATE_KEY   — VAPID private key (min 32 chars)
//   JWT_SECRET          — HMAC signing secret (min 32 chars)
//   STORAGE_BASE_PATH   — Absolute path to NAS file storage root
//   DB_PATH             — Path to SQLite database file (default below)
// Run: infisical run -- node dist/index.js

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Ollama
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_CODING_MODEL: z.string().default('qwen2.5-coder:7b'),
  OLLAMA_REASONING_MODEL: z.string().default('qwen3:latest'),
  OLLAMA_VISION_MODEL: z.string().default('qwen2.5-vl:7b'),
  OLLAMA_EMBED_MODEL: z.string().default('nomic-embed-text'),

  // General
  DEVMIND_API_KEY: z.string().default(''),
  WORKSPACE_ROOT: z.string().default(process.cwd()),
  VECTOR_DB_PATH: z.string().default('./data/vectors'),
  SQLITE_PATH: z.string().default('./data/checkpoints.db'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  MAX_TOOL_TIMEOUT_MS: z.coerce.number().default(30_000),
  ALLOWED_SHELL_COMMANDS: z
    .string()
    .default('git,npm,pnpm,node,tsc,eslint,jest,vitest'),

  // Database
  DB_PATH: z.string().default('./data/devmind.db'),

  // Storage
  STORAGE_BASE_PATH: z.string(),

  // JWT (required — provisioned in Infisical)
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_MS: z.coerce.number().default(900_000),      // 15 min
  JWT_REFRESH_TTL_MS: z.coerce.number().default(604_800_000), // 7 days

  // VAPID / Web Push (required — provisioned in Infisical)
  VAPID_PUBLIC_KEY: z.string(),
  VAPID_PRIVATE_KEY: z.string().min(32),
  VAPID_SUBJECT: z.string().default('mailto:admin@devmind.casa'),

  // Upload limits
  MAX_UPLOAD_BYTES: z.coerce.number().default(104_857_600), // 100 MiB

  // Feature flags
  FLAG_CACHE_TTL_MS: z.coerce.number().default(300_000), // 5 min

  // Signed URLs
  SIGNED_URL_TTL_MS: z.coerce.number().default(3_600_000), // 1 hour

  // WebAuthn
  WEBAUTHN_RP_ID: z.string().default('devmind.casa'),
  WEBAUTHN_RP_NAME: z.string().default('DevMind'),
  WEBAUTHN_DISABLED: z.coerce.boolean().default(false),
});

export type Config = z.infer<typeof ConfigSchema>;

export const config = ConfigSchema.parse(process.env);
