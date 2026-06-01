import { InfisicalSDK } from '@infisical/sdk';

const PROJECT_ID = 'devmind-pxgt';
const ENVIRONMENT = process.env.INFISICAL_ENVIRONMENT ?? 'dev';

const SECRET_NAMES = [
  'STORAGE_BASE_PATH',
  'JWT_SECRET',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'PORT',
] as const;

let loaded = false;

export async function loadSecrets(): Promise<void> {
  if (loaded) return;

  const clientId = process.env.INFISICAL_CLIENT_ID;
  const clientSecret = process.env.INFISICAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.warn('Infisical credentials missing. Skipping Infisical secrets load and relying on local environment variables');
    return;
  }

  const sdk = new InfisicalSDK({
    siteUrl: process.env.INFISICAL_SITE_URL ?? 'http://infisical.casa',
  });

  await sdk.auth().universalAuth.login({
    clientId,
    clientSecret,
  });

  for (const name of SECRET_NAMES) {
    try {
      const { secretValue } = await sdk.secrets().getSecret({
        secretName: name,
        projectId: PROJECT_ID,
        environment: ENVIRONMENT,
      });
      if (secretValue) {
        process.env[name] = secretValue;
      }
    } catch {
      if (!process.env[name]) {
        throw new Error(`Missing required secret: ${name}`);
      }
    }
  }

  loaded = true;
}
