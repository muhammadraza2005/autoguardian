const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('Login setup rejects the placeholder and accepts SQL punctuation in a password', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role autoguardian_identity_api nologin nobypassrls;');
    const sql = await fs.readFile(path.resolve(__dirname, '../../supabase/setup-identity-login.sql'), 'utf8');
    await assert.rejects(() => db.exec(sql), e => e.code === 'P0001');
    await db.exec('rollback');
    // Synthetic test password, not a project credential.
    await db.exec(sql.replace('$password$PASTE_PASSWORD_HERE$password$', "$password$Test-only%'quoted$$password-123456$password$"));
    const { rows } = await db.query(`select rolcanlogin, rolinherit, rolsuper, rolbypassrls,
      pg_has_role('autoguardian_identity_login', 'autoguardian_identity_api', 'MEMBER') as member
      from pg_roles where rolname='autoguardian_identity_login'`);
    assert.deepEqual(rows, [{ rolcanlogin: true, rolinherit: false, rolsuper: false, rolbypassrls: false, member: true }]);
  } finally { await db.close(); }
});
