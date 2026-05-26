-- 008-keycloak-oidc Phase 4.1
-- Add Keycloak subject linking column to users (NULL while user is local-only).
-- After cleanup phase (post-migration) the column becomes NOT NULL.

ALTER TABLE users ADD COLUMN kc_subject TEXT;
ALTER TABLE users ADD COLUMN email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_kc_subject
  ON users(kc_subject)
  WHERE kc_subject IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
  ON users(email)
  WHERE email IS NOT NULL;
