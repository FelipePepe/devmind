#!/usr/bin/env tsx
/**
 * Reset MFA para un usuario existente
 * Usa: tsx scripts/reset-user-mfa.ts <username>
 */

import { generateTotpSetup } from '../packages/backend/src/auth/totp.js';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..');

const DB_PATH = process.env.SQLITE_PATH || join(root, 'data', 'devmind.db');

async function resetUserMfa(username: string) {
  const db = new Database(DB_PATH, { fileMustExist: false });

  const user = db.prepare('SELECT id, username, totp_secret, totp_confirmed FROM users WHERE username = ?').get(username) as any;

  if (!user) {
    console.error(`Usuario "${username}" no encontrado`);
    process.exit(1);
  }

  console.log(`\nUsuario actual:`);
  console.log(`  ID: ${user.id}`);
  console.log(`  TOTP Secret: ${user.totp_secret || '(vacío)'}`);
  console.log(`  TOTP Confirmado: ${user.totp_confirmed ? 'Sí' : 'No'}`);

  // Generar nuevo TOTP secret
  const { secret: newSecret, uri: newUri } = generateTotpSetup(username);

  // Actualizar usuario
  db.prepare(`
    UPDATE users
    SET totp_secret = ?, totp_confirmed = 0
    WHERE id = ?
  `).run(newSecret, user.id);

  console.log(`\n✅ MFA reseteado para "${username}"`);
  console.log(`\n📱 Escanea este QR en tu authenticator:`);
  console.log(`   (o copia la URI manualmente)`);
  console.log(`\n${newUri}`);
  console.log(`\n🔐 Tu nuevo TOTP secret (backup):`);
  console.log(`   ${newSecret}`);
  console.log(`\n⚠️  El usuario debe completar el registro (confirmar primer código TOTP)`);
  console.log(`   POST /auth/register/confirm con el código de su authenticator\n`);

  db.close();
}

const username = process.argv[2];
if (!username) {
  console.error('Uso: tsx scripts/reset-user-mfa.ts <username>');
  process.exit(1);
}

resetUserMfa(username).catch(err => {
  console.error(err);
  process.exit(1);
});
