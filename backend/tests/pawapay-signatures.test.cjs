const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, createHash, sign, constants } = require('node:crypto');
const { verifyPawaPayCallbackSignature } = require('../dist/pawaPaySignatures');
const now = new Date('2026-10-13T12:00:00Z');
const timestamp = now.getTime() / 1000;
const callbackUrl = 'https://sandbox-callback.example/v1/webhooks/pawapay/deposits';
const requiredComponents = ['@method', '@authority', '@path', 'signature-date', 'content-digest', 'content-type'];
const keys = {
  rsa: generateKeyPairSync('rsa', { modulusLength: 2048 }),
  p256: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
  p384: generateKeyPairSync('ec', { namedCurve: 'secp384r1' }),
};

// Independent sender fixture uses actual node crypto and the documented base.
function fixture(algorithm = 'ecdsa-p256-sha256', options = {}) {
  const key = algorithm.startsWith('rsa') ? keys.rsa : algorithm.includes('384') ? keys.p384 : keys.p256;
  const body = Buffer.from('{"depositId":"saved-reference","status":"COMPLETED"}\n');
  const created = options.created ?? timestamp;
  const expires = options.expires ?? created + 60;
  const digestAlgorithm = options.digest ?? 'sha-512';
  const digest = `${digestAlgorithm}=:${createHash(digestAlgorithm.replace('-', '')).update(body).digest('base64')}:`;
  const components = options.components ?? requiredComponents;
  const params = `(${components.map(value => `"${value}"`).join(' ')});alg="${algorithm}";keyid="HTTP_TEST_KEY:1";created=${created};expires=${expires}`;
  const date = new Date(created * 1000).toISOString();
  const values = { '@method': 'POST', '@authority': 'sandbox-callback.example', '@path': '/v1/webhooks/pawapay/deposits', 'signature-date': date, 'content-type': 'application/json; charset=UTF-8', 'content-digest': digest };
  const base = [...components.map(value => `"${value}": ${values[value]}`), `"@signature-params": ${params}`].join('\n');
  const hash = algorithm.includes('512') ? 'sha512' : algorithm.includes('384') ? 'sha384' : 'sha256';
  const signOptions = { key: key.privateKey };
  if (algorithm === 'rsa-pss-sha512') Object.assign(signOptions, { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 64 });
  if (algorithm.startsWith('ecdsa')) signOptions.dsaEncoding = options.encoding ?? 'der';
  return {
    rawBody: body, callbackUrl, now,
    publicKeys: [{ id: 'HTTP_TEST_KEY:1', key: key.publicKey.export({ type: 'spki', format: 'pem' }) }],
    headers: { 'signature-input': `sig-pp=${params}`, signature: `sig-pp=:${sign(hash, Buffer.from(base), signOptions).toString('base64')}:`, 'signature-date': date, 'content-type': values['content-type'], 'content-digest': digest },
  };
}

for (const algorithm of ['rsa-pss-sha512', 'rsa-v1_5-sha256', 'ecdsa-p256-sha256', 'ecdsa-p384-sha384']) {
  test(`verifies actual ${algorithm} callback and deterministic receipt fingerprint`, () => {
    const request = fixture(algorithm);
    const result = verifyPawaPayCallbackSignature(request);
    assert.equal(result.verified, true, result.reason);
    assert.equal(result.algorithm, algorithm);
    assert.equal(result.keyId, 'HTTP_TEST_KEY:1');
    assert.equal(result.fingerprint, verifyPawaPayCallbackSignature(request).fingerprint);
  });
}

test('accepts RFC fixed-width ECDSA and SHA256 digest, signed component ordering', () => {
  for (const algorithm of ['ecdsa-p256-sha256', 'ecdsa-p384-sha384']) {
    const result = verifyPawaPayCallbackSignature(fixture(algorithm, { encoding: 'ieee-p1363', digest: 'sha-256', components: [...requiredComponents].reverse() }));
    assert.equal(result.verified, true, result.reason);
  }
});

test('rejects body tampering including whitespace and wrong configured destination', () => {
  const request = fixture();
  for (const changed of [
    { rawBody: Buffer.from(request.rawBody.toString().trim()) },
    { rawBody: Buffer.from(request.rawBody.toString().replace('COMPLETED', 'FAILED')) },
    { callbackUrl: callbackUrl.replace('sandbox-callback.example', 'other.example') },
    { callbackUrl: callbackUrl.replace('/deposits', '/refunds') },
    { callbackUrl: callbackUrl + '?unsigned-query=1' },
    { callbackUrl: callbackUrl.replace('https:', 'http:') },
  ]) assert.equal(verifyPawaPayCallbackSignature({ ...request, ...changed }).verified, false);
});

test('ignores spoofed host/forwarded headers and binds the trusted configured URL', () => {
  const request = fixture();
  request.headers.host = 'attacker.example';
  request.headers['x-forwarded-host'] = 'attacker.example';
  assert.equal(verifyPawaPayCallbackSignature(request).verified, true);
});

test('rejects expired/future/old signatures, excessively broad lifetime and date mismatch', () => {
  for (const options of [
    { created: timestamp - 400 }, { created: timestamp + 100 },
    { created: timestamp - 100, expires: timestamp - 40 }, { expires: timestamp + 3600 }, { expires: timestamp },
  ]) assert.equal(verifyPawaPayCallbackSignature(fixture(undefined, options)).verified, false);
  const request = fixture();
  request.headers['signature-date'] = '2026-10-13T12:00:01Z';
  assert.equal(verifyPawaPayCallbackSignature(request).verified, false);
});

test('rejects incomplete coverage, unknown key, algorithm substitution and mismatched EC curve', () => {
  assert.equal(verifyPawaPayCallbackSignature(fixture(undefined, { components: requiredComponents.slice(1) })).verified, false);
  const request = fixture();
  assert.equal(verifyPawaPayCallbackSignature({ ...request, publicKeys: [] }).verified, false);
  assert.equal(verifyPawaPayCallbackSignature({ ...request, publicKeys: [...request.publicKeys, ...request.publicKeys] }).verified, false);
  assert.equal(verifyPawaPayCallbackSignature({ ...request, publicKeys: [{ id: 'HTTP_TEST_KEY:1', key: keys.p384.publicKey.export({ type: 'spki', format: 'pem' }) }] }).verified, false);
  request.headers['signature-input'] = request.headers['signature-input'].replace('ecdsa-p256-sha256', 'hmac-sha256');
  assert.equal(verifyPawaPayCallbackSignature(request).verified, false);
});

test('rejects ambiguous multi-signature/header forms and modified content type/signature', () => {
  for (const mutate of [
    h => { h.Signature = h.signature; },
    h => { h.signature = [h.signature]; },
    h => { h.signature += ', sig-other=:AAAA:'; },
    h => { h['signature-input'] += ', sig-other=();created=1'; },
    h => { h['signature-input'] = h['signature-input'].replace(';expires=', ';created='); },
    h => { h['content-type'] = 'application/json'; },
    h => { h.signature = h.signature.replace(/sig-pp=:[A-Za-z0-9]/, 'sig-pp=:A'); },
    h => { h['content-digest'] += '\n'; },
  ]) {
    const request = fixture(); mutate(request.headers);
    assert.equal(verifyPawaPayCallbackSignature(request).verified, false);
  }
});
