/**
 * One-shot Keycloak setup for spec 008 tasks 1.1 + 1.3 + 1.4 + 1.5.
 * Run: KC_ADMIN_PASS=xxx pnpm exec ts-node --esm scripts/kc-setup.ts
 * Or:  KC_ADMIN_PASS=xxx pnpm exec playwright test scripts/kc-setup.ts --headed
 *
 * Uses the Keycloak Admin REST API (no browser automation needed).
 */

const KC_BASE = 'https://auth.casa';
const REALM = 'casa';
const ADMIN_USER = process.env['KC_ADMIN_USER'] ?? 'felipe';
const ADMIN_PASS = process.env['KC_ADMIN_PASS'] ?? (() => { throw new Error('KC_ADMIN_PASS required'); })();

const CLIENT_ID = 'devmind-frontend';
const REDIRECT_URIS = [
  'http://devmind.casa/callback',
  'http://localhost:5173/callback',
  'http://localhost:5001/callback',
];
const POST_LOGOUT_URIS = [
  'http://devmind.casa/',
  'http://localhost:5173/',
  'http://localhost:5001/',
];
const WEB_ORIGINS = [
  'http://devmind.casa',
  'http://localhost:5173',
  'http://localhost:5001',
];

async function getAdminToken(): Promise<string> {
  const res = await fetch(`${KC_BASE}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: ADMIN_USER,
      password: ADMIN_PASS,
    }),
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

async function api(token: string, method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${KC_BASE}/admin/realms/${REALM}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function step(label: string, fn: () => Promise<void>) {
  process.stdout.write(`  ${label}... `);
  try {
    await fn();
    console.log('✓');
  } catch (e) {
    console.log('✗');
    throw e;
  }
}

async function main() {
  console.log('\n── KC setup: spec 008 tasks 1.1 + 1.3 + 1.4 + 1.5 ──\n');

  const token = await getAdminToken();
  console.log('✓ Admin token OK\n');

  // ── 1.5 Realm role `admin` ──────────────────────────────────────────────
  console.log('[1.5] Realm role "admin"');
  await step('create role', async () => {
    const res = await api(token, 'POST', '/roles', { name: 'admin', description: 'DevMind admin' });
    if (res.status === 409) { console.log('(ya existe) '); return; }
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  });

  // ── 1.1 Client devmind-frontend ─────────────────────────────────────────
  console.log('\n[1.1] Client "devmind-frontend"');

  // Check if client already exists
  let clientUuid: string;
  await step('check / create client', async () => {
    const existing = await api(token, 'GET', `/clients?clientId=${CLIENT_ID}`);
    const list = await existing.json() as Array<{ id: string }>;
    if (list.length > 0) {
      clientUuid = list[0]!.id;
      console.log('(ya existe, actualizando) ');
    } else {
      const res = await api(token, 'POST', '/clients', {
        clientId: CLIENT_ID,
        enabled: true,
        publicClient: true,
        standardFlowEnabled: true,
        implicitFlowEnabled: false,
        directAccessGrantsEnabled: false,
        serviceAccountsEnabled: false,
        redirectUris: REDIRECT_URIS,
        postLogoutRedirectUris: POST_LOGOUT_URIS,
        webOrigins: WEB_ORIGINS,
        attributes: { 'pkce.code.challenge.method': 'S256' },
        protocol: 'openid-connect',
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      // GET uuid from Location header
      const location = res.headers.get('location') ?? '';
      clientUuid = location.split('/').pop()!;
    }
  });

  // Update redirect URIs + PKCE if client already existed
  await step('update redirect URIs + PKCE', async () => {
    const res = await api(token, 'PUT', `/clients/${clientUuid!}`, {
      clientId: CLIENT_ID,
      enabled: true,
      publicClient: true,
      standardFlowEnabled: true,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
      redirectUris: REDIRECT_URIS,
      postLogoutRedirectUris: POST_LOGOUT_URIS,
      webOrigins: WEB_ORIGINS,
      attributes: { 'pkce.code.challenge.method': 'S256' },
      protocol: 'openid-connect',
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  });

  // ── 1.3 Default scopes ──────────────────────────────────────────────────
  console.log('\n[1.3] Default scopes (openid, profile, email)');
  await step('verify default scopes on client', async () => {
    const res = await api(token, 'GET', `/clients/${clientUuid!}/default-client-scopes`);
    const scopes = await res.json() as Array<{ name: string }>;
    const names = scopes.map(s => s.name);
    const missing = ['openid', 'profile', 'email'].filter(n => !names.includes(n));
    if (missing.length === 0) {
      console.log('(ya asignados) ');
      return;
    }
    // Fetch all realm scopes to get their IDs
    const allRes = await api(token, 'GET', '/client-scopes');
    const all = await allRes.json() as Array<{ id: string; name: string }>;
    for (const name of missing) {
      const scope = all.find(s => s.name === name);
      if (!scope) { console.log(`(scope ${name} no encontrado en realm) `); continue; }
      const addRes = await api(token, 'PUT', `/clients/${clientUuid!}/default-client-scopes/${scope.id}`);
      if (!addRes.ok) throw new Error(`${addRes.status} ${await addRes.text()}`);
    }
  });

  // ── 1.4 Mapper realm_access.roles → id_token ───────────────────────────
  console.log('\n[1.4] Mapper realm_access.roles en id_token');
  await step('add/update protocol mapper', async () => {
    // Check existing mappers on the dedicated scope
    const mappersRes = await api(token, 'GET', `/clients/${clientUuid!}/protocol-mappers/models`);
    const mappers = await mappersRes.json() as Array<{ id: string; name: string }>;
    const existing = mappers.find(m => m.name === 'realm roles');

    const mapperDef = {
      name: 'realm roles',
      protocol: 'openid-connect',
      protocolMapper: 'oidc-usermodel-realm-role-mapper',
      consentRequired: false,
      config: {
        'claim.name': 'realm_access.roles',
        'jsonType.label': 'String',
        'id.token.claim': 'true',
        'access.token.claim': 'true',
        'userinfo.token.claim': 'true',
        'multivalued': 'true',
      },
    };

    if (existing) {
      const res = await api(token, 'PUT', `/clients/${clientUuid!}/protocol-mappers/models/${existing.id}`, { ...mapperDef, id: existing.id });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      console.log('(actualizado) ');
    } else {
      const res = await api(token, 'POST', `/clients/${clientUuid!}/protocol-mappers/models`, mapperDef);
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    }
  });

  console.log('\n── Setup completo ──\n');
  console.log('Client UUID:', clientUuid!);
  console.log('Próximo paso: ajustar .env + correr e2e 8.4-8.6\n');
}

main().catch(e => { console.error('\n✗ Error:', e.message); process.exit(1); });
