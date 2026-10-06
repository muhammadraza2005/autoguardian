const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SupabaseIdentityVerifier, developmentEmailAllowed } = require('../dist/auth');

test('Email exception is opt-in and refuses production or unspecified environment', () => {
  assert.equal(developmentEmailAllowed({ NODE_ENV: 'production' }), false);
  assert.equal(developmentEmailAllowed({ NODE_ENV: 'development', ALLOW_DEV_EMAIL_AUTH: 'true' }), true);
  assert.throws(() => developmentEmailAllowed({ NODE_ENV: 'production', ALLOW_DEV_EMAIL_AUTH: 'true' }));
  assert.throws(() => developmentEmailAllowed({ ALLOW_DEV_EMAIL_AUTH: 'true' }));
});

test('Confirmed email works only in development; anonymous/unconfirmed users still fail', async () => {
  const original = global.fetch;
  let user = { id: '00000000-0000-4000-8000-000000000001', email: 'test@example.invalid',
    email_confirmed_at: '2026-01-01', is_anonymous: false, user_metadata: { role: 'PLATFORM_ADMIN' } };
  global.fetch = async () => new Response(JSON.stringify(user), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    const standard = new SupabaseIdentityVerifier('https://test.supabase.co', 'test-public-key');
    const development = new SupabaseIdentityVerifier('https://test.supabase.co', 'test-public-key', true);
    await assert.rejects(() => standard.verify('Bearer test'), e => e.getStatus() === 403);
    assert.equal(await development.verify('Bearer test'), user.id);
    user = { ...user, email_confirmed_at: null };
    await assert.rejects(() => development.verify('Bearer test'), e => e.getStatus() === 403);
    user = { ...user, email_confirmed_at: '2026-01-01', is_anonymous: true };
    await assert.rejects(() => development.verify('Bearer test'), e => e.getStatus() === 403);
  } finally { global.fetch = original; }
});
