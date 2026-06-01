/**
 * Lightweight request tracing without OTEL packages.
 * Generates a traceId per HTTP request, threads it through agent loops and
 * tool calls via ToolContext, and injects it into every log line via pino child.
 *
 * Grafana/Loki users can filter by traceId to correlate all logs from one
 * chat message → agent loop → tool calls chain.
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../logger.js';

/** Generate a new trace ID (compact 16-char hex). */
export function newTraceId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

/** Returns a pino child logger bound to a traceId. */
export function traceLogger(traceId: string) {
  return logger.child({ traceId });
}
