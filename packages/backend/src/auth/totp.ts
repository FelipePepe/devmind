import * as OTPAuth from 'otpauth';

export interface TotpSetup {
  secret: string; // base32-encoded secret for storage
  uri: string;    // otpauth:// URI for QR code / authenticator import
}

export function generateTotpSetup(username: string): TotpSetup {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: 'DevMind',
    label: username,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });
  return { secret: totp.secret.base32, uri: totp.toString() };
}

export function verifyTotpCode(secret: string, code: string): boolean {
  const totp = new OTPAuth.TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  // window: 1 allows ±1 time step (30 s tolerance)
  return totp.validate({ token: code.replace(/\s/g, ''), window: 1 }) !== null;
}
