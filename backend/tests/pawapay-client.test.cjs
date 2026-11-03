const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('node:util');
const { PawaPaySandboxClient, pawaPaySandboxConfiguration, confirmSandboxDeposit } = require('../dist/pawaPayClient');
const deposit = { depositId: 'f4401bd2-1568-4140-bf2d-eb77d2b2b639', amount: '1000', currency: 'CDF', payer: { type: 'MMO', accountDetails: { phoneNumber: '243813456789', provider: 'VODACOM_MPESA_COD' } } };
const token = 'private-test-token';
const response = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('sandbox configuration fails closed for production and client inspection does not reveal credentials', () => {
  const env = { PAWAPAY_BASE_URL: 'https://api.sandbox.pawapay.io', PAWAPAY_API_TOKEN: token };
  assert.equal(pawaPaySandboxConfiguration(env).token, token);
  for (const changed of [{ NODE_ENV: 'production' }, { PAWAPAY_BASE_URL: 'https://api.pawapay.io' }, { PAWAPAY_BASE_URL: 'https://other.example' }, { PAWAPAY_API_TOKEN: '' }]) assert.throws(() => pawaPaySandboxConfiguration({ ...env, ...changed }));
  const client = new PawaPaySandboxClient({ token });
  assert.equal(inspect(client).includes(token), false);
  assert.equal(JSON.stringify(client).includes(token), false);
});

test('initiation uses v2 sandbox, bearer authentication, a saved reference, no redirects and no automatic retries', async () => {
  let calls = 0;
  const client = new PawaPaySandboxClient({ token }, async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.sandbox.pawapay.io/v2/deposits');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.deepEqual(JSON.parse(options.body), deposit);
    return response({ depositId: deposit.depositId, status: 'ACCEPTED' });
  });
  assert.equal((await client.initiateDeposit(deposit)).status, 'ACCEPTED');
  assert.equal(calls, 1);
  let failedCalls = 0;
  const failed = new PawaPaySandboxClient({ token }, async () => { failedCalls++; throw new Error(token); });
  await assert.rejects(failed.initiateDeposit(deposit), error => !error.message.includes(token) && /reconcile/.test(error.message));
  assert.equal(failedCalls, 1);
});

test('malformed deposits and unsafe status references never reach the provider', async () => {
  const client = new PawaPaySandboxClient({ token }, async () => { assert.fail('Unexpected request'); });
  await assert.rejects(client.depositStatus('../unsafe'));
  for (const changed of [{ depositId: 'bad' }, { amount: '-1' }, { amount: '1e3' }, { currency: 'EUR' }, { payer: { type: 'MMO', accountDetails: { phoneNumber: 'real-or-invalid', provider: 'WRONG' } } }]) await assert.rejects(client.initiateDeposit({ ...deposit, ...changed }));
});

test('status retrieval handles NOT_FOUND, checks identity and does not trust HTTP success alone', async () => {
  for (const data of [{ status: 'NOT_FOUND' }, { status: 'FOUND', data: { depositId: deposit.depositId, status: 'PROCESSING' } }]) {
    const client = new PawaPaySandboxClient({ token }, async () => response(data));
    const result = await client.depositStatus(deposit.depositId);
    assert.equal(result?.status, data.data?.status);
  }
  for (const data of [{ status: 'FOUND', data: { depositId: 'wrong', status: 'COMPLETED' } }, { status: 'FOUND', data: { depositId: deposit.depositId, status: 'PAID' } }]) {
    await assert.rejects(new PawaPaySandboxClient({ token }, async () => response(data)).depositStatus(deposit.depositId));
  }
  await assert.rejects(new PawaPaySandboxClient({ token }, async () => new Response(token, { status: 401 })).depositStatus(deposit.depositId), /HTTP 401/);
});

test('confirmation matches exact decimal amounts, currency, country, payer and reference; pending and failed are not paid', () => {
  const data = { ...deposit, amount: '1000.00', country: 'COD', status: 'COMPLETED' };
  assert.equal(confirmSandboxDeposit(deposit, data), true);
  assert.equal(confirmSandboxDeposit(deposit, { ...data, status: 'PROCESSING' }), false);
  assert.equal(confirmSandboxDeposit(deposit, { ...data, status: 'FAILED' }), false);
  for (const changed of [{ depositId: 'wrong' }, { amount: '999.99' }, { currency: 'USD' }, { country: 'ZMB' }, { payer: { type: 'MMO', accountDetails: { ...deposit.payer.accountDetails, phoneNumber: '243813456039' } } }]) assert.throws(() => confirmSandboxDeposit(deposit, { ...data, ...changed }));
});
