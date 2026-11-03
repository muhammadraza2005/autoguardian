const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { inspect } = require('node:util');
const { PawaPaySandboxPublicKeys } = require('../dist/pawaPayPublicKeys');
const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'pem', type: 'spki' });
const response = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

test('retrieves fixed sandbox public keys securely and caches/consolidates concurrent requests', async () => {
  let calls = 0, time = 0;
  const client = new PawaPaySandboxPublicKeys({ token: 'private-token', ttlMs: 1000 }, async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.sandbox.pawapay.io/v2/public-key/http');
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    assert.ok(options.signal instanceof AbortSignal);
    return response([{ id: 'HTTP_EC_P256_KEY:1', key }]);
  }, () => time);
  const [first, second] = await Promise.all([client.getKeys(), client.getKeys()]);
  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first[0]));
  assert.equal((await client.getKey('HTTP_EC_P256_KEY:1')).key, key);
  await assert.rejects(client.getKey('unknown'));
  assert.equal(calls, 1);
  time = 1000;
  await client.getKeys();
  assert.equal(calls, 2);
  assert.equal(inspect(client).includes('private-token'), false);
  assert.equal(JSON.stringify(client).includes('private-token'), false);
});

test('rejects malformed/duplicate/unsupported keys and does not expose responses or credentials', async () => {
  for (const payload of [[], {}, [{ id: 'id', key: 'private-token' }], [{ id: 'id', key }, { id: 'id', key }], [{ id: '\n', key }]]) {
    const client = new PawaPaySandboxPublicKeys({ token: 'private-token' }, async () => response(payload));
    await assert.rejects(client.getKeys(), error => !error.message.includes('private-token'));
  }
  const client = new PawaPaySandboxPublicKeys({ token: 'private-token' }, async () => { throw new Error('private-token'); });
  await assert.rejects(client.getKeys(), error => !error.message.includes('private-token'));
});

test('expired keys fail closed on provider outage instead of using stale cache', async () => {
  let time = 0, calls = 0;
  const client = new PawaPaySandboxPublicKeys({ token: 'private-token', ttlMs: 1000 }, async () => {
    if (calls++) return new Response('', { status: 503 });
    return response([{ id: 'id', key }]);
  }, () => time);
  await client.getKeys(); time = 1000;
  await assert.rejects(client.getKeys());
  await assert.rejects(client.getKey('id'));
});
