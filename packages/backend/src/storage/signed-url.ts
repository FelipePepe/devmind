import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export function generateToken(
  artifactId: string,
  userId: string,
  expiresAt: number
): string {
  const hmac = createHmac('sha256', config.JWT_SECRET)
    .update(`${artifactId}:${userId}:${expiresAt}`)
    .digest('hex');
  return `${hmac}.${expiresAt}`;
}

export function verifyToken(
  rawToken: string,
  artifactId: string,
  userId: string,
  now = Date.now()
): boolean {
  const dotIdx = rawToken.lastIndexOf('.');
  if (dotIdx === -1) return false;

  const hmac = rawToken.slice(0, dotIdx);
  const expiresAt = Number(rawToken.slice(dotIdx + 1));

  if (isNaN(expiresAt) || expiresAt <= now) return false;

  const expected = createHmac('sha256', config.JWT_SECRET)
    .update(`${artifactId}:${userId}:${expiresAt}`)
    .digest('hex');

  try {
    return timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
