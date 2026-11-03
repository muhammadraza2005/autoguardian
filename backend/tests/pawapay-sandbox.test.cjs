const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readdir, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createPawaPaySandboxReceiver } = require('../dist/pawaPaySandbox');
const reference = 'f4401bd2-1568-4140-bf2d-eb77d2b2b639';
async function fixture(t, extra = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'autoguardian-pawapay-'));
  const server = await createPawaPaySandboxReceiver({ environment: 'development', sandboxEnabled: true, directory, ...extra });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (type, body) => fetch(`${url}/v1/webhooks/pawapay/${type}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { directory, server, url, post };
}

test('signature-required receiver verifies exact raw bytes before journaling and fails closed',async t=>{
 let valid=false,calls=0;
 const body='{ "depositId": "'+reference+'", "status": "COMPLETED" }';
 const f=await fixture(t,{authenticate:async(type,raw,headers)=>{
   calls++;assert.equal(type,'deposits');assert.equal(raw.toString(),body);assert.equal(headers['content-type'],'application/json');return valid;
 }});
 assert.equal((await f.post('deposits',body)).status,401);assert.equal((await readdir(f.directory)).length,0);
 valid=true;assert.equal((await f.post('deposits',body)).status,200);
 const files=await readdir(f.directory),receipt=JSON.parse(await readFile(join(f.directory,files[0]),'utf8'));
 assert.equal(receipt.signatureVerified,true);assert.equal(receipt.trusted,false);assert.equal(calls,2);
});

test('all four public callback routes persist untrusted receipts, never wallet details, and deduplicate retries', async t => {
  const f = await fixture(t);
  for (const [type, key] of Object.entries({ checkouts: 'checkoutId', deposits: 'depositId', payouts: 'payoutId', refunds: 'refundId' })) {
    const body = { [key]: reference, status: 'COMPLETED', payer: { phoneNumber: '243000000001' }, metadata: { secret: 'DO_NOT_STORE' } };
    assert.equal((await fetch(`${f.url}/v1/webhooks/pawapay/${type}`)).status, 200);
    const received = await f.post(type, body);
    assert.equal(received.status, 200);
    assert.deepEqual(await received.json(), { received: true, trusted: false, duplicate: false });
    assert.deepEqual(await (await f.post(type, body)).json(), { received: true, trusted: false, duplicate: true });
  }
  const files = await readdir(f.directory);
  assert.equal(files.length, 4);
  for (const file of files) {
    const text = await readFile(join(f.directory, file), 'utf8');
    assert.equal(text.includes('243000000001'), false);
    assert.equal(text.includes('DO_NOT_STORE'), false);
    assert.equal(JSON.parse(text).trusted, false);
  }
  assert.equal((await fetch(`${f.url}/v1/me/vehicles`)).status, 404);
});

test('sandbox receipt endpoint rejects malformed, wrong-operation and oversized requests', async t => {
  const f = await fixture(t);
  for (const body of ['{', [], {}, { payoutId: reference, status: 'COMPLETED' }, { depositId: '../path', status: 'COMPLETED' }, { depositId: reference, status: 'PAID' }]) {
    assert.equal((await f.post('deposits', body)).status, 400);
  }
  assert.equal((await fetch(`${f.url}/v1/webhooks/pawapay/deposits`, { method: 'POST', body: '{}' })).status, 415);
  const large = await f.post('deposits', { depositId: reference, status: 'COMPLETED', padding: 'a'.repeat(65536) });
  assert.equal(large.status, 413);
  assert.equal((await readdir(f.directory)).length, 0);
});

test('journal survives receiver restart and does not acknowledge new callbacks when capacity is exhausted', async t => {
  const f = await fixture(t, { maxReceipts: 1 });
  const body = { depositId: reference, status: 'FAILED' };
  assert.equal((await f.post('deposits', body)).status, 200);
  const restarted = await createPawaPaySandboxReceiver({ environment: 'development', sandboxEnabled: true, directory: f.directory, maxReceipts: 1 });
  await new Promise(resolve => restarted.listen(0, '127.0.0.1', resolve));
  t.after(async () => { restarted.closeAllConnections(); await new Promise(resolve => restarted.close(resolve)); });
  const url = `http://127.0.0.1:${restarted.address().port}/v1/webhooks/pawapay/deposits`;
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.deepEqual(await response.json(), { received: true, trusted: false, duplicate: true });
  assert.equal((await f.post('deposits', { ...body, status: 'COMPLETED' })).status, 503);
});

test('bootstrap service cannot start in production or without explicit sandbox opt-in', async () => {
  for (const options of [{ environment: 'production', sandboxEnabled: true }, { environment: 'development', sandboxEnabled: false }]) {
    await assert.rejects(createPawaPaySandboxReceiver({ ...options, directory: 'unused' }), /sandbox only/);
  }
});
