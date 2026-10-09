import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealLocationBody, sealLocationsSchema, readSealLocations, saveSealLocations } from '../src/features/enrollment/sealLocations.ts';
import { sealLocationEn, sealLocationFr } from '../src/i18n/sealLocationResources.ts';
const id = '00000000-0000-4000-8000-000000000001';
const body = { expectedDraftRevision: 2, expectedFittingRevision: 1, expectedLocationRevision: 0,
  locations: [4, 3, 2, 1].map(position => ({ position, description: ' Fictional location ' + position + ' ' })) };
const result = { version: 1, draftId: id, draftRevision: 2, fittingRevision: 1, locationRevision: 1,
  package: 'STANDARD', required: true, current: true, complete: true,
  locations: body.locations.map(item => ({ ...item, description: item.description.trim() })), savedAt: '2026-10-10T00:00:00Z',
  sampleOnly: true, policyVerified: false, physicalVerified: false };
test('placement notes require four valid positions and cannot claim policy or inspection approval', () => {
  assert.ok(sealLocationBody.safeParse(body).success);
  for (const patch of [{ locations: body.locations.slice(1) }, { physicalVerified: true }, { expectedFittingRevision: 0 },
    { locations: body.locations.map(item => ({ ...item, position: 1 })) },
    ...[' ', 'x'.repeat(201), 'bad\nlocation'].map(description => ({ locations: body.locations.map(item => ({ ...item, description })) }))]) {
    assert.equal(sealLocationBody.safeParse({ ...body, ...patch }).success, false);
  }
  for (const patch of [{ physicalVerified: true }, { policyVerified: true }, { current: false }, { complete: false }, { savedAt: null }, { package: null }]) {
    assert.equal(sealLocationsSchema.safeParse({ ...result, ...patch }).success, false);
  }
  assert.ok(sealLocationsSchema.safeParse({ ...result, current: false, complete: false, locations: [], savedAt: null }).success);
  assert.ok(sealLocationsSchema.safeParse({ ...result, package: 'NONE', required: false, current: false, locations: [], savedAt: null }).success);
});
test('placement reads and writes are scoped and exact retries preserve the request key', async () => {
  const calls = [];
  const request = async (route, options) => { calls.push({ route, options }); return result; };
  await readSealLocations(request, id);
  await saveSealLocations(request, id, id, body);
  await saveSealLocations(request, id, id, body);
  assert.equal(calls[0].route, '/v1/enrollment-drafts/' + id + '/seals/locations');
  assert.deepEqual(calls[1], calls[2]);
  assert.deepEqual(calls[1].options.body.locations.map(item => item.position), [1, 2, 3, 4]);
  assert.equal(calls[1].options.body.locations[0].description, 'Fictional location 1');
  await assert.rejects(() => readSealLocations(async () => ({ ...result, draftId: '00000000-0000-4000-8000-000000000002' }), id));
  await assert.rejects(() => readSealLocations(async () => { throw new Error('Denied'); }, id), /Denied/);
});
test('all placement controls and states have English and French copy', () => {
  assert.deepEqual(Object.keys(sealLocationEn).sort(), Object.keys(sealLocationFr).sort());
  assert.ok(Object.values(sealLocationEn).every(value => value.length > 0));
  assert.ok(Object.values(sealLocationFr).every(value => value.length > 0));
});
