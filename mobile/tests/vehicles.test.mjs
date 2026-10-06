import test from 'node:test';
import assert from 'node:assert/strict';
import { readVehiclePage, readVehicleDetail } from '../src/features/vehicles/contracts.ts';

const id = '6f512d69-4070-4f05-8a30-2bbdb0fd9a1d';
const vehicle = {
  id, chassisIdentifier: 'AUTOGUARDIAN-DEV-VEHICLE-001', plate: 'DEV-001', category: 'CAR',
  make: 'Development', model: 'Test vehicle', manufactureYear: null, color: null,
  saleStatus: 'NOT_FOR_SALE', recordStatus: 'PENDING_REVIEW',
  createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z', ownedSince: '2026-10-06T00:00:00.000Z',
};

test('owned list uses the scoped endpoint, preserves pending/unpaid states, and strips private fields', async () => {
  const controller = new AbortController();
  const page = await readVehiclePage(async (path, options) => {
    assert.equal(path, '/v1/me/vehicles?limit=20');
    assert.equal(options.signal, controller.signal);
    return { items: [{ ...vehicle, legalName: 'Private', sealPackage: 'FOUR_ALARMS' }], nextCursor: id };
  }, undefined, controller.signal);
  assert.equal(page.items[0].recordStatus, 'PENDING_REVIEW');
  assert.equal('legalName' in page.items[0], false);
  assert.equal('sealPackage' in page.items[0], false);
  const next = await readVehiclePage(async path => {
    assert.equal(path, '/v1/me/vehicles?limit=20&cursor=' + id);
    return { items: [{ ...vehicle, recordStatus: 'SUSPENDED_UNPAID' }], nextCursor: null };
  }, page.nextCursor);
  assert.equal(next.items[0].recordStatus, 'SUSPENDED_UNPAID');
});

test('empty owned list remains empty and malformed responses cannot turn into sample vehicles', async () => {
  assert.deepEqual(await readVehiclePage(async () => ({ items: [], nextCursor: null })), { items: [], nextCursor: null });
  await assert.rejects(readVehiclePage(async () => ({ items: [ { ...vehicle, recordStatus: 'APPROVED' } ], nextCursor: null })));
  await assert.rejects(readVehiclePage(async () => ({ items: [ { ...vehicle, id: 'sample-1' } ], nextCursor: null })));
  await assert.rejects(readVehiclePage(async () => ({ items: [], nextCursor: id })));
  await assert.rejects(readVehiclePage(async () => ({ items: [vehicle], nextCursor: id }), id));
});

test('detail loads independently and rejects the wrong vehicle or an invalid route before fetching', async () => {
  const detail = await readVehicleDetail(async path => {
    assert.equal(path, '/v1/me/vehicles/' + id);
    return { vehicle };
  }, id.toUpperCase());
  assert.equal(detail.plate, 'DEV-001');
  await assert.rejects(readVehicleDetail(async () => ({ vehicle: { ...vehicle, id: '00000000-0000-4000-8000-000000000099' } }), id));
  let called = false;
  await assert.rejects(readVehicleDetail(async () => { called = true; }, '../other-owner'));
  assert.equal(called, false);
});

test('access failures and cancelled requests are propagated without a fixture fallback', async () => {
  for (const status of [401, 403, 404, 503]) {
    const error = Object.assign(new Error('Request failed'), { status });
    await assert.rejects(readVehicleDetail(async () => { throw error; }, id), value => value === error);
    await assert.rejects(readVehiclePage(async () => { throw error; }), value => value === error);
  }
  const controller = new AbortController();
  const pending = readVehiclePage((_path, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  }), undefined, controller.signal);
  controller.abort();
  await assert.rejects(pending, /Aborted/);
});
