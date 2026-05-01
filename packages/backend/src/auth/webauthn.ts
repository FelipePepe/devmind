import {
  generateRegistrationOptions as genRegOpts,
  verifyRegistrationResponse,
  generateAuthenticationOptions as genAuthOpts,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { ChallengesRepo } from '../db/repos/challenges.js';
import type { UsersRepo } from '../db/repos/users.js';

// Guard: WEBAUTHN_DISABLED=true is never allowed in production
if (config.WEBAUTHN_DISABLED && config.NODE_ENV === 'production') {
  logger.error('WEBAUTHN_DISABLED=true is not allowed in production. Exiting.');
  process.exit(1);
}

export interface StoredCredential {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: AuthenticatorTransportFuture[];
}

export async function generateRegistrationOptions(
  userId: string,
  displayName: string,
  challenges: ChallengesRepo
): Promise<ReturnType<typeof genRegOpts>> {
  const options = await genRegOpts({
    rpID: config.WEBAUTHN_RP_ID,
    rpName: config.WEBAUTHN_RP_NAME,
    userID: new TextEncoder().encode(userId),
    userName: displayName,
    attestationType: 'none',
    authenticatorSelection: { userVerification: 'preferred' },
  });

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  challenges.create(options.challenge, 'registration', expiresAt, userId);

  return options;
}

export async function verifyRegistration(
  response: RegistrationResponseJSON,
  challenges: ChallengesRepo
): Promise<StoredCredential> {
  const row = challenges.findByChallenge(response.response.clientDataJSON
    ? (() => {
        const decoded = JSON.parse(
          Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8')
        ) as { challenge: string };
        return decoded.challenge;
      })()
    : '');

  // Always delete challenge immediately regardless of outcome
  if (row) challenges.deleteByChallenge(row.challenge);

  if (!row || new Date(row.expires_at) < new Date()) {
    throw Object.assign(new Error('Challenge expired or not found'), { status: 400 });
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: row.challenge,
    expectedOrigin: `https://${config.WEBAUTHN_RP_ID}`,
    expectedRPID: config.WEBAUTHN_RP_ID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw Object.assign(new Error('Registration verification failed'), { status: 400 });
  }

  const { credential } = verification.registrationInfo;
  return {
    credentialId: Buffer.from(credential.id).toString('base64url'),
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports ?? [],
  };
}

export async function generateAuthenticationOptions(
  challenges: ChallengesRepo,
  users: UsersRepo,
  credentialId?: string
): Promise<ReturnType<typeof genAuthOpts>> {
  const allowCredentials = credentialId
    ? [{ id: credentialId }]
    : [];

  const options = await genAuthOpts({
    rpID: config.WEBAUTHN_RP_ID,
    userVerification: 'preferred',
    ...(allowCredentials.length > 0 ? { allowCredentials } : {}),
  });

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  challenges.create(options.challenge, 'authentication', expiresAt);
  // Suppress unused param warning
  void users;

  return options;
}

export async function verifyAuthentication(
  response: AuthenticationResponseJSON,
  challenges: ChallengesRepo,
  users: UsersRepo
): Promise<string> {
  const clientData = JSON.parse(
    Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8')
  ) as { challenge: string };

  const row = challenges.findByChallenge(clientData.challenge);
  if (row) challenges.deleteByChallenge(row.challenge);

  if (!row || new Date(row.expires_at) < new Date()) {
    throw Object.assign(new Error('Challenge expired or not found'), { status: 401 });
  }

  const user = users.findByCredentialId(response.rawId);
  if (!user) throw Object.assign(new Error('Unknown credential'), { status: 401 });

  const stored: StoredCredential = JSON.parse(user.credential) as StoredCredential;

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: row.challenge,
    expectedOrigin: `https://${config.WEBAUTHN_RP_ID}`,
    expectedRPID: config.WEBAUTHN_RP_ID,
    credential: {
      id: stored.credentialId,
      publicKey: Uint8Array.from(Buffer.from(stored.publicKey, 'base64url')),
      counter: stored.counter,
      transports: stored.transports,
    },
  });

  if (!verification.verified) {
    throw Object.assign(new Error('Authentication failed'), { status: 401 });
  }

  // Update counter
  const newCounter = verification.authenticationInfo.newCounter;
  const updated: StoredCredential = { ...stored, counter: newCounter };
  users.updateCredential(user.id, stored.credentialId, JSON.stringify(updated));

  return user.id;
}
