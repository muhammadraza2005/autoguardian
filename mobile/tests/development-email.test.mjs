import test from 'node:test';
import assert from 'node:assert/strict';
import { profileSchema, profileSession } from '../src/features/auth/profile.ts';

test('email development flag cannot enable the email screen in release or demo mode', async () => {
  const before = { dev: globalThis.__DEV__, mode: process.env.EXPO_PUBLIC_APP_MODE, email: process.env.EXPO_PUBLIC_DEV_EMAIL_AUTH };
  try {
    process.env.EXPO_PUBLIC_DEV_EMAIL_AUTH = 'true';
    for (const [dev, mode, allowed] of [[false, 'live', false], [false, 'demo', false], [true, 'demo', false], [true, 'live', true]]) {
      globalThis.__DEV__ = dev;
      process.env.EXPO_PUBLIC_APP_MODE = mode;
      const { runtime } = await import(`../src/config/runtime.ts?email=${dev}-${mode}`);
      assert.equal(runtime.developmentEmailAuth, allowed);
    }
  } finally {
    globalThis.__DEV__ = before.dev;
    for (const [key, value] of [['EXPO_PUBLIC_APP_MODE', before.mode], ['EXPO_PUBLIC_DEV_EMAIL_AUTH', before.email]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('loaded profile cannot grant unfinished privileged sections or infer an absent verifier role', () => {
  const profile = profileSchema.parse({ id: '00000000-0000-4000-8000-000000000001',
    tenantId: '00000000-0000-4000-8000-000000000002', preferredLanguage: 'en',
    roles: [{ code: 'PLATFORM_ADMIN', organizationId: null }] });
  assert.deepEqual(profileSession(profile).sectionGrants, []);
  profile.roles.push({ code: 'VERIFIER', organizationId: null });
  assert.deepEqual(profileSession(profile).sectionGrants, ['consumer']);
  assert.throws(() => profileSchema.parse({ ...profile, roles: 'PLATFORM_ADMIN' }));
});
