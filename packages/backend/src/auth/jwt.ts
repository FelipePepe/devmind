import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';

const encoder = new TextEncoder();

function getSecret(): Uint8Array {
  return encoder.encode(config.JWT_SECRET);
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AccessPayload {
  userId: string;
  isAdmin: boolean;
}

export interface RefreshPayload {
  userId: string;
}

export async function sign(userId: string, isAdmin: boolean): Promise<TokenPair> {
  const secret = getSecret();

  // jti uniqueness: iat/exp are second-precision, so two pair issues for the
  // same user within one second would produce identical refresh JWTs and
  // collide on the UNIQUE token_hash index in refresh_tokens.
  const accessToken = await new SignJWT({ sub: userId, isAdmin })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + config.JWT_ACCESS_TTL_MS) / 1000))
    .sign(secret);

  const refreshToken = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + config.JWT_REFRESH_TTL_MS) / 1000))
    .sign(secret);

  return { accessToken, refreshToken };
}

export async function verifyAccess(token: string): Promise<AccessPayload> {
  const { payload } = await jwtVerify(token, getSecret());
  if (typeof payload.sub !== 'string') throw new Error('Invalid token');
  return {
    userId: payload.sub,
    isAdmin: payload['isAdmin'] === true,
  };
}

export async function verifyRefresh(token: string): Promise<RefreshPayload> {
  const { payload } = await jwtVerify(token, getSecret());
  if (typeof payload.sub !== 'string') throw new Error('Invalid token');
  return { userId: payload.sub };
}
