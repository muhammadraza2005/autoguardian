const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const sharp = require('sharp');
const { PGlite } = require('@electric-sql/pglite');
const { UnauthorizedException } = require('@nestjs/common');
const { createApp } = require('../dist/app');
const { PostgresEnrollmentStore, DevelopmentDraftVerifier } = require('../dist/enrollments');
const { OwnerService, PostgresOwnerStore, ownerCipher } = require('../dist/owner');
const { EvidenceService, PostgresEvidenceStore, evidenceCipher } = require('../dist/evidence');
const { PostgresSealStore } = require('../dist/seals');
const { PostgresReadinessStore } = require('../dist/readiness');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = 'ce31527e-d1b5-4379-9ddd-1458cfb73431';
const profile = '369cbe75-32c8-40b4-a9ee-f2d9bde379db';
const organization = '014db61a-4c68-48cb-86b6-46837f4da873';

// Full five-step API journey in disposable PostgreSQL. Auth and Storage providers
// are isolated doubles; controllers, validation, encryption and RLS are real.
test('complete development enrollment through HTTP remains a draft and owner edits invalidate preparation', async () => {
  const db = new PGlite();
  let app;
  const objects = new Map();
  let failReadBack = false;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create role autoguardian_identity_login nologin;
      create schema auth; create table auth.users(id uuid primary key);`);
    const migrations = path.resolve(__dirname, '../../supabase/migrations');
    for (const file of (await fs.readdir(migrations)).filter(f => f.endsWith('.sql')).sort()) {
      await db.exec(await fs.readFile(path.join(migrations, file), 'utf8'));
    }
    await db.exec(`insert into auth.users values ('${id(1)}');
      insert into app.tenants(id,code,name_en,country_code,currency_code,time_zone)
      values ('${tenant}','AUTOGUARDIAN_DEV','Development','CD','USD','Africa/Kinshasa');
      insert into app.users(id,tenant_id,auth_user_id) values ('${profile}','${tenant}','${id(1)}');`);
    for (const file of ['setup-development-agent.sql', 'setup-development-owner.sql', 'setup-development-seal-stock.sql']) {
      await db.exec(await fs.readFile(path.resolve(__dirname, '../../supabase', file), 'utf8'));
    }
    const pool = { connect: async () => ({ query: async (sql, values) => {
      const result = await db.query(sql, values);
      return { rows: result.rows, rowCount: result.rows.length || result.affectedRows || 0 };
    }, release() {} }) };
    const auth = { verify: async header => {
      if (header !== 'Bearer synthetic-agent') throw new UnauthorizedException();
      return id(1);
    } };
    const master = randomBytes(32);
    const storage = { check: async () => {}, put: async (key, bytes) => {
      if (!objects.has(key)) objects.set(key, Buffer.from(bytes));
    }, get: async key => {
      if (failReadBack) throw new Error('Synthetic provider interruption');
      return objects.get(key);
    } };
    app = await createApp(auth, { load: async () => ({}) }, undefined, undefined, {
      auth: new DevelopmentDraftVerifier(auth, true), store: new PostgresEnrollmentStore(pool, tenant),
      owner: new OwnerService(new PostgresOwnerStore(pool, tenant), ownerCipher(master)),
      evidence: new EvidenceService(new PostgresEvidenceStore(pool, tenant), storage, evidenceCipher(master)),
      seals: new PostgresSealStore(pool, tenant), readiness: new PostgresReadinessStore(pool, tenant),
    });
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    let sequence = 100;
    async function request(route, { method = 'GET', body, key, status = 200 } = {}) {
      const response = await fetch(base + '/v1/' + route, { method, headers: {
        Authorization: 'Bearer synthetic-agent', 'Content-Type': 'application/json',
        ...(key ? { 'Idempotency-Key': key } : {}),
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const result = await response.json();
      assert.equal(response.status, status, `${method} ${route}: ${JSON.stringify(result)}`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      return result;
    }
    const vehicle = { chassisIdentifier: 'SYNTHETIC-ACCEPTANCE-001', plate: 'SAMPLE-001', category: 'CAR' };
    const creation = { organizationId: organization, ownerProfileId: profile, vehicle };
    const creationKey = id(sequence++);
    const { draft } = await request('enrollment-drafts', { method: 'POST', key: creationKey, body: creation });
    const route = 'enrollment-drafts/' + draft.id;
    assert.equal((await request('enrollment-drafts', { method: 'POST', key: creationKey, body: creation })).draft.id, draft.id);
    await request('enrollment-drafts', { method: 'POST', key: id(sequence++), body: creation, status: 409 });
    const details = { type: 'INDIVIDUAL', name: 'Fictional Acceptance Owner', companyRegistration: null,
      representativeName: null, idDocumentType: 'SAMPLE', idDocumentNumber: 'SAMPLE-ID',
      phone: '+243000000000', preferredLanguage: 'fr' };
    const owner = await request(route + '/owner', { method: 'POST', key: id(sequence++),
      body: { expectedDraftRevision: draft.revision, details } });
    await request(route + '/owner/consent', { method: 'POST', key: id(sequence++), body: {
      expectedDraftRevision: owner.draftRevision, ownerGeneration: owner.ownerGeneration,
      version: owner.documents.find(document => document.language === 'fr').version,
      language: 'fr', accept: true, termsAccepted: true, dataAccepted: true,
    } });
    const pdf = Buffer.from('%PDF-1.4\nSynthetic acceptance document only\n%%EOF\n');
    const upload = (kind, bytes, options = {}) => request(route + '/attachments', {
      method: 'POST', key: id(sequence++), body: { kind, dataBase64: bytes.toString('base64') }, ...options,
    });
    const identityKey = id(sequence++);
    failReadBack = true;
    await upload('OWNER_ID', pdf, { key: identityKey, status: 503 });
    let evidence = await request(route + '/attachments');
    assert.equal(evidence.items[0].status, 'PENDING');
    assert.equal(evidence.evidenceChecklist.items[0].status, 'PENDING');
    const reviewsRoute = route + '/attachments/reviews';
    const reviewRoute = route + '/attachments/' + identityKey + '/review';
    const reviewBody = { expectedDraftRevision: owner.draftRevision, expectedReviewRevision: 0,
      decision: 'NEEDS_CORRECTION', reason: 'BLURRY' };
    assert.equal((await request(reviewsRoute)).items[0].decision, 'NOT_REVIEWED');
    await request(reviewRoute, { method: 'POST', key: id(sequence++), body: reviewBody, status: 409 });
    failReadBack = false;
    await upload('OWNER_ID', pdf, { key: identityKey });
    await upload('OWNER_ID', pdf, { key: identityKey });
    assert.equal((await request(route + '/attachments')).items.length, 1);
    const reviewKey = id(sequence++);
    let reviews = await request(reviewRoute, { method: 'POST', key: reviewKey, body: reviewBody });
    assert.equal(reviews.items[0].decision, 'NEEDS_CORRECTION');
    assert.equal(reviews.items[0].reason, 'BLURRY');
    assert.equal(reviews.items[0].reviewRevision, 1);
    assert.equal(reviews.sampleOnly, true); assert.equal(reviews.productionApproved, false); assert.equal(reviews.canSubmit, false);
    await request(reviewRoute, { method: 'POST', key: reviewKey, body: reviewBody });
    assert.equal((await db.query('select count(*)::int n from private.development_evidence_reviews')).rows[0].n, 1);
    await request(reviewRoute, { method: 'POST', key: reviewKey, body: { ...reviewBody, reason: 'INCOMPLETE' }, status: 409 });
    await request(reviewRoute, { method: 'POST', key: id(sequence++), body: reviewBody, status: 409 });
    for (const body of [{ ...reviewBody, reason: null }, { ...reviewBody, decision: 'APPROVED' },
      { ...reviewBody, productionApproved: true }, { ...reviewBody, expectedReviewRevision: 0.5 },
      { ...reviewBody, decision: 'ACCEPTED_SAMPLE' }, { ...reviewBody, reason: 'Private free text' }]) {
      await request(reviewRoute, { method: 'POST', key: id(sequence++), body, status: 400 });
    }
    await request(reviewsRoute + '?tenantId=' + tenant, { status: 400 });
    await request(route + '/attachments/' + id(999) + '/review', { method: 'POST', key: id(sequence++), body: reviewBody, status: 404 });
    reviews = await request(reviewRoute, { method: 'POST', key: id(sequence++), body: {
      ...reviewBody, expectedReviewRevision: 1, decision: 'ACCEPTED_SAMPLE', reason: null,
    } });
    assert.equal(reviews.items[0].decision, 'ACCEPTED_SAMPLE'); assert.equal(reviews.items[0].reviewRevision, 2);
    assert.equal(reviews.items[0].reason, null);
    assert.equal((await db.query('select count(*)::int n from private.development_evidence_reviews')).rows[0].n, 2);
    for (const role of ['anon', 'authenticated', 'service_role', 'autoguardian_enrollment_api']) {
      await db.exec('begin;set local role ' + role);
      await assert.rejects(() => db.query('select * from private.development_evidence_reviews'), error => error.code === '42501');
      await db.exec('rollback');
    }
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await db.exec('begin;set local role ' + role);
      await assert.rejects(() => db.query('select private.development_evidence_reviews_read($1)', [draft.id]), error => error.code === '42501');
      await db.exec('rollback');
    }
    for (const action of ['update private.development_evidence_reviews set reason=null', 'delete from private.development_evidence_reviews']) {
      await db.exec('begin;set local role autoguardian_enrollment_executor');
      await assert.rejects(() => db.query(action), error => error.code === '42501');
      await db.exec('rollback');
    }
    assert.equal(await new PostgresEvidenceStore(pool, id(999)).reviews(id(1), draft.id).catch(error => error.getStatus()), 403);
    const changedVehicle = await request(route, { method: 'PUT', body: { ...creation,
      expectedRevision: owner.draftRevision, vehicle: { ...vehicle, color: 'Synthetic blue' } } });
    owner.draftRevision = changedVehicle.draft.revision;
    reviews = await request(reviewsRoute);
    assert.equal(reviews.items[0].decision, 'NOT_REVIEWED');
    assert.equal(reviews.items[0].reviewRevision, 2);
    assert.equal(reviews.items[0].reason, null); assert.equal(reviews.items[0].reviewedAt, null);
    await request(reviewRoute, { method: 'POST', key: id(sequence++), body: { ...reviewBody, expectedReviewRevision: 2 }, status: 409 });
    assert.equal((await request(reviewRoute, { method: 'POST', key: reviewKey, body: reviewBody })).items[0].decision, 'NOT_REVIEWED');
    await upload('PURCHASE_PROOF', pdf);
    const photoKinds = ['VEHICLE_FRONT', 'VEHICLE_REAR', 'VEHICLE_LEFT', 'VEHICLE_RIGHT', 'CHASSIS_PHOTO', 'PLATE_PHOTO'];
    const images = [];
    for (let index = 0; index < 10; index++) {
      images.push(await sharp({ create: { width: 32, height: 32, channels: 3,
        background: { r: index * 20, g: 100, b: 200 } } }).png().toBuffer());
    }
    await upload('VEHICLE_FRONT', pdf, { status: 400 });
    await upload(photoKinds[0], images[0]);
    await upload(photoKinds[1], images[0], { status: 409 });
    for (let index = 1; index < photoKinds.length; index++) await upload(photoKinds[index], images[index]);
    evidence = await request(route + '/attachments');
    assert.equal(evidence.evidenceChecklist.items.length, 8);
    assert.equal(evidence.evidenceChecklist.complete, true);
    assert.ok(evidence.items.every(item => item.status === 'STAGED'));
    const fittingPhotos = [];
    for (const image of images.slice(6)) fittingPhotos.push((await upload('SEAL_FITTING_PHOTO', image)).attachment.id);
    assert.equal((await request(route + '/attachments')).items.length, 12);
    const fitting = { expectedDraftRevision: owner.draftRevision, expectedFittingRevision: 0,
      package: 'STANDARD', placements: fittingPhotos.map((photoId, index) => ({ position: index + 1,
        sealCode: 'DEV-SEAL-STD-00' + (index + 1), photoId })) };
    const eventCount = async () => (await db.query('select count(*)::int n from private.draft_seal_events')).rows[0].n;
    const before = await eventCount();
    assert.equal((await request(route + '/seals/validate', { method: 'POST', body: fitting })).sealValidation.complete, true);
    assert.equal(await eventCount(), before);
    const fittingKey = id(sequence++);
    await request(route + '/seals', { method: 'POST', key: fittingKey, body: fitting });
    await request(route + '/seals', { method: 'POST', key: fittingKey, body: fitting });
    assert.equal(await eventCount(), before + 1);
    let ready = await request(route + '/readiness');
    assert.ok(ready.checks.filter(check => !['AGENT_AUTHENTICATION', 'OWNER_PHONE', 'CONSENT',
      'PRODUCTION_EVIDENCE', 'PAYMENT', 'REVIEW_POLICY', 'FINALIZATION'].includes(check.code))
      .every(check => check.status === 'COMPLETE'));
    assert.ok(ready.checks.filter(check => ['AGENT_AUTHENTICATION', 'OWNER_PHONE', 'CONSENT',
      'PRODUCTION_EVIDENCE', 'PAYMENT', 'REVIEW_POLICY', 'FINALIZATION'].includes(check.code))
      .every(check => check.status === 'UNAVAILABLE'));
    assert.equal(ready.canSubmit, false);
    assert.equal(ready.enrollmentActive, false);
    assert.equal(ready.sealValidation.physicalVerified, false);
    const locationRoute = route + '/seals/locations';
    assert.equal((await request(locationRoute)).complete, false);
    const locationBody = { expectedDraftRevision: owner.draftRevision, expectedFittingRevision: 1, expectedLocationRevision: 0,
      locations: [4, 3, 2, 1].map(position => ({ position, description: '  Fictional placement ' + position + '  ' })) };
    const locationKey = id(sequence++);
    let notes = await request(locationRoute, { method: 'POST', key: locationKey, body: locationBody });
    assert.equal(notes.complete, true); assert.equal(notes.current, true);
    assert.equal(notes.locationRevision, 1);
    assert.equal(notes.policyVerified, false); assert.equal(notes.physicalVerified, false);
    assert.deepEqual(notes.locations.map(item => item.position), [1, 2, 3, 4]);
    assert.equal(notes.locations[0].description, 'Fictional placement 1');
    await request(locationRoute, { method: 'POST', key: locationKey, body: locationBody });
    assert.equal((await db.query('select count(*)::int n from private.draft_seal_location_events')).rows[0].n, 1);
    await request(locationRoute, { method: 'POST', key: id(sequence++), body: locationBody, status: 409 });
    await request(locationRoute, { method: 'POST', key: locationKey, body: { ...locationBody,
      locations: locationBody.locations.map(item => ({ ...item, description: 'Changed placement' })) }, status: 409 });
    await request(locationRoute, { method: 'POST', key: id(sequence++), body: { ...locationBody, physicalVerified: true }, status: 400 });
    await request(locationRoute, { method: 'POST', key: id(sequence++), body: { ...locationBody, locations: locationBody.locations.slice(1) }, status: 400 });
    await request(locationRoute, { method: 'POST', key: id(sequence++), body: { ...locationBody,
      locations: locationBody.locations.map(item => ({ ...item, description: 'bad\nlocation' })) }, status: 400 });
    await request(locationRoute + '?tenantId=' + tenant, { status: 400 });
    await request('enrollment-drafts/' + id(999) + '/seals/locations', { status: 404 });
    for (const role of ['anon', 'authenticated', 'service_role', 'autoguardian_enrollment_api']) {
      await db.exec('begin;set local role ' + role);
      await assert.rejects(() => db.query('select * from private.draft_seal_location_notes'), error => error.code === '42501');
      await db.exec('rollback');
    }
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await db.exec('begin;set local role ' + role);
      await assert.rejects(() => db.query('select private.draft_seal_locations_read($1)', [draft.id]), error => error.code === '42501');
      await db.exec('rollback');
    }
    assert.equal((await new PostgresSealStore(pool, id(999)).locations(id(1), draft.id).catch(error => error.getStatus())), 403);
    await request(route + '/seals', { method: 'POST', key: id(sequence++), body: { ...fitting, expectedFittingRevision: 1 } });
    notes = await request(locationRoute);
    assert.equal(notes.current, false); assert.deepEqual(notes.locations, []);
    await request(locationRoute, { method: 'POST', key: id(sequence++), body: { ...locationBody, expectedFittingRevision: 2, expectedLocationRevision: 1 } });
    const summary = JSON.stringify(ready);
    for (const secret of [details.name, details.phone, 'object_path', 'sha256', 'photoId', 'sealCode']) assert.ok(!summary.includes(secret));
    assert.ok([...objects.values()].every(bytes => bytes.subarray(0, 4).toString() === 'AG01'));
    await request(route + '/owner', { method: 'POST', key: id(sequence++), body: {
      expectedDraftRevision: owner.draftRevision, details: { ...details, name: 'Fictional Changed Owner' },
    } });
    ready = await request(route + '/readiness');
    assert.equal(ready.checks.find(check => check.code === 'CONSENT_SAMPLE').status, 'MISSING');
    assert.equal(ready.checks.find(check => check.code === 'SEAL_FITTING').status, 'STALE');
    assert.equal(ready.evidenceChecklist.complete, false);
    assert.deepEqual((await request(route + '/attachments')).items, []);
    assert.deepEqual((await request(reviewsRoute)).items, []);
    assert.deepEqual((await request(reviewRoute, { method: 'POST', key: reviewKey, body: reviewBody })).items, []);
    await request(reviewRoute, { method: 'POST', key: id(sequence++), body: reviewBody, status: 409 });
    await request(reviewRoute, { method: 'POST', key: id(sequence++), body: { ...reviewBody,
      expectedDraftRevision: owner.draftRevision + 1, expectedReviewRevision: 2 }, status: 404 });
    notes = await request(locationRoute);
    assert.equal(notes.current, false); assert.equal(notes.complete, false);
    assert.deepEqual(notes.locations, []); assert.equal(notes.savedAt, null);
    const replayedNotes = await request(locationRoute, { method: 'POST', key: locationKey, body: locationBody });
    assert.equal(replayedNotes.current, false); assert.deepEqual(replayedNotes.locations, []);
    await request(locationRoute, { method: 'POST', key: id(sequence++), body: locationBody, status: 409 });
    await request(route + '/seals', { method: 'POST', key: id(sequence++), body: fitting, status: 409 });
    await request(route + '/seals', { method: 'POST', key: id(sequence++), body: {
      expectedDraftRevision: owner.draftRevision + 1, expectedFittingRevision: 2, package: 'NONE', placements: [],
    } });
    const noSealNotes = await request(locationRoute);
    assert.equal(noSealNotes.required, false); assert.equal(noSealNotes.complete, true);
    assert.deepEqual(noSealNotes.locations, []);
    await request(locationRoute, { method: 'POST', key: id(sequence++), body: {
      ...locationBody, expectedDraftRevision: owner.draftRevision + 1, expectedFittingRevision: 3, expectedLocationRevision: 2,
    }, status: 409 });
    for (const table of ['app.vehicles', 'app.ownerships', 'private.owners']) {
      assert.equal((await db.query('select count(*)::int n from ' + table)).rows[0].n, 0);
    }
    await db.exec(`update app.agent_accreditations set status='REVOKED' where user_id='${profile}'`);
    await request(route + '/readiness', { status: 403 });
    await request(locationRoute, { status: 403 });
    await request(reviewsRoute, { status: 403 });
    await request(reviewRoute, { method: 'POST', key: id(sequence++), body: reviewBody, status: 403 });
  } finally {
    await app?.close();
    await db.close();
  }
});
