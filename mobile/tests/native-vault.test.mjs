import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import {Buffer} from 'node:buffer';
import { createEncryptedVault } from '../src/features/enrollment/encryptedVault.ts';
import { createNativeWorkingCopies } from '../src/features/enrollment/nativeWorkingCopyStore.ts';
import { evidenceRecoveryId, pendingEvidenceSchema } from '../src/features/enrollment/pendingEvidence.ts';
import {ownerRecoverySchema} from '../src/features/enrollment/ownerRecoverySchema.ts';
import {evidenceReviewAttemptSchema} from '../src/features/enrollment/evidenceReviews.ts';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = value => createHash('sha256').update(value).digest('hex');
function fixture() {
  const files = new Map(); let key = null, failWrite = false, failDelete = false;
  const io = {
    async keyRead() { return key; }, async keyWrite(value) { key = value; },
    async keyDelete() { key = null; }, async read(name) { return files.get(name) ?? null; },
    async write(name, value) { if (failWrite) throw new Error('Disk full'); files.set(name, value); },
    async remove(name) { files.delete(name); },
    async clear() { if (failDelete) throw new Error('Cleanup unavailable'); files.clear(); },
  };
  const crypto = {
    async hash(value) { return hash(value); }, async generate() { return randomBytes(32).toString('hex'); },
    async seal(value, key, context) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
      cipher.setAAD(Buffer.from(context));
      const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64');
    },
    async open(value, key, context) {
      const bytes = Buffer.from(value, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8');
    },
  };
  return { files, io, crypto, vault: () => createEncryptedVault(io, crypto),
    failWrites: value => { failWrite = value; }, failCleanup: value => { failDelete = value; }, key: () => key };
}
test('AES-GCM recovery persists ciphertext only and rejects tampering and record substitution', async () => {
  const f = fixture(), vault = f.vault(); await vault.identify('tenant-A/agent-A');
  await vault.write('draft-A', 'Fictional owner — résumé');
  const saved = f.files.get(hash('draft-A'));
  assert.ok(saved && !saved.includes('Fictional') && !saved.includes('résumé'));
  assert.equal(await vault.read('draft-A'), 'Fictional owner — résumé');
  const fresh = f.vault(); await fresh.identify('tenant-A/agent-A');
  assert.equal(await fresh.read('draft-A'), 'Fictional owner — résumé');
  f.files.set(hash('draft-B'), saved); await assert.rejects(fresh.read('draft-B'));
  const corrupted = Buffer.from(saved, 'base64'); corrupted[15] ^= 1;
  f.files.set(hash('draft-A'), corrupted.toString('base64')); await assert.rejects(fresh.read('draft-A'));
});
test('tenant/role changes erase old keys; logout locks immediately even when ciphertext cleanup fails', async () => {
  const f = fixture(), vault = f.vault(); await vault.identify('tenant-A/agent-A/roles-1');
  await vault.write('draft', 'sample secret'); const firstKey = f.key();
  await vault.identify('tenant-A/agent-A/roles-2'); assert.notEqual(f.key(), firstKey);
  assert.equal(await vault.read('draft'), null); await vault.write('draft', 'new sample');
  f.failCleanup(true); const cleared = vault.clear();
  await assert.rejects(cleared); assert.equal(f.key(), null); await assert.rejects(vault.read('draft'));
  f.failCleanup(false); await vault.identify('tenant-B/agent-B'); assert.equal(await vault.read('draft'), null);
});
test('logout during encryption cannot resurrect files; failed writes preserve the last committed value', async () => {
  const f = fixture(), vault = f.vault(); await vault.identify('agent'); await vault.write('draft', 'before');
  f.failWrites(true); await assert.rejects(vault.write('draft', 'after')); assert.equal(await vault.read('draft'), 'before');
  f.failWrites(false);
  let resume; let entered;
  const began = new Promise(resolve => { entered = resolve; });
  const original = f.crypto.seal;
  f.crypto.seal = async (...args) => { entered(); await new Promise(resolve => { resume = resolve; }); return original(...args); };
  const writing = vault.write('draft', 'late'); const rejected = assert.rejects(writing);
  await began; const clearing = vault.clear(); resume(); await rejected; await clearing;
  assert.equal(f.files.size, 0); assert.equal(f.key(), null);
});
test('native vehicle/seal forms recover exact retry payloads and report storage errors', async () => {
  const f = fixture(), first = createNativeWorkingCopies(f.vault()), scope = 'tenant/agent';
  const body = { expectedDraftRevision: 1, expectedFittingRevision: 0, package: 'STANDARD',
    placements: [{ position: 1, sealCode: 'DEV-SAMPLE-1', photoId: id(3) }] };
  const copy = { kind: 'seals', draftRevision: 1, fittingRevision: 0, package: 'STANDARD',
    slots: [1, 2, 3, 4].map(position => ({ position, sealCode: position === 1 ? 'DEV-SAMPLE-1' : '', photoId: position === 1 ? id(3) : null })),
    pending: { key: id(4), body } };
  await first.prepare(scope); first.write(scope, id(1), copy); await first.flush();
  assert.equal(first.getStatus(), 'ready');
  const restored = createNativeWorkingCopies(f.vault()); await restored.prepare(scope);
  assert.deepEqual(restored.read(scope, 'seals', id(1)), copy);
  assert.equal(restored.read('different', 'seals', id(1)), null);
  f.failWrites(true); restored.remove(scope, 'seals', id(1)); await assert.rejects(restored.flush());
  assert.equal(restored.getStatus(), 'failed');
  f.failWrites(false); restored.write(scope, id(1), copy); await restored.flush();
  assert.equal(restored.getStatus(), 'ready');
  const clearing = restored.clear(); assert.equal(restored.read(scope, 'seals', id(1)), null); await clearing;
  assert.equal(f.key(), null); assert.equal(f.files.size, 0);
});
test('oversized records and malformed encrypted recovery fail closed', async () => {
  const f = fixture(), vault = f.vault(); await vault.identify('scope');
  await assert.rejects(vault.write('too-large', 'x'.repeat(3 * 1024 * 1024 + 1)));
  await vault.write('working-copies', JSON.stringify([['unexpected-key', 'private']]));
  const copies = createNativeWorkingCopies(f.vault()); await assert.rejects(copies.prepare('scope'));
  assert.equal(copies.getStatus(), 'failed'); assert.equal(copies.read('scope', 'vehicle', id(1)), null);
});
test('attachment retry journals encrypt file bytes and bind recovery to draft, slot and original owner generation',async()=>{
  const f=fixture(),vault=f.vault();await vault.identify('tenant/agent');
  const attempt={key:id(4),body:{kind:'OWNER_ID',dataBase64:Buffer.from('Synthetic file bytes').toString('base64'),
    uploadContext:{draftRevision:3,ownerGeneration:2}}};
  const record=evidenceRecoveryId(id(1),'documents');
  await vault.write(record,JSON.stringify(pendingEvidenceSchema.parse(attempt)));
  const fresh=f.vault();await fresh.identify('tenant/agent');
  assert.deepEqual(pendingEvidenceSchema.parse(JSON.parse(await fresh.read(record))),attempt);
  const encrypted=f.files.get(hash(record));assert.ok(!encrypted.includes('Synthetic') && !encrypted.includes(attempt.body.dataBase64));
  f.files.set(hash(evidenceRecoveryId(id(2),'documents')),encrypted);
  await assert.rejects(fresh.read(evidenceRecoveryId(id(2),'documents')));
  f.files.set(hash(evidenceRecoveryId(id(1),'fitting-1')),encrypted);
  await assert.rejects(fresh.read(evidenceRecoveryId(id(1),'fitting-1')));
  assert.throws(()=>evidenceRecoveryId(id(1),'../outside'));
  assert.throws(()=>pendingEvidenceSchema.parse({...attempt,body:{...attempt.body,fileName:'private-name'}}));
});
test('owner identity and consent retries recover only from authenticated encrypted records',async()=>{
  const f=fixture(),vault=f.vault();await vault.identify('tenant/agent');
  const recovery={draftRevision:2,ownerGeneration:1,ownerProfileId:id(1),type:'INDIVIDUAL',language:'fr',
    fields:{name:'Fictional Sample Owner',companyRegistration:'',representativeName:'',idDocumentType:'SAMPLE',idDocumentNumber:'SAMPLE-1',phone:'+920000000000'},
    terms:true,data:true,pending:{kind:'consent',key:id(4),body:{expectedDraftRevision:2,ownerGeneration:1,
      version:'sample-v1',language:'fr',accept:true,termsAccepted:true,dataAccepted:true}}};
  await vault.write('owner:'+id(1),JSON.stringify(ownerRecoverySchema.parse(recovery)));
  const fresh=f.vault();await fresh.identify('tenant/agent');
  assert.deepEqual(ownerRecoverySchema.parse(JSON.parse(await fresh.read('owner:'+id(1)))),recovery);
  for(const encrypted of f.files.values())assert.ok(!encrypted.includes('Fictional') && !encrypted.includes('+920000000000'));
  assert.throws(()=>ownerRecoverySchema.parse({...recovery,pin:'1234'}));
  await fresh.clear();assert.equal(f.files.size,0);
});
test('native review recovery retains the original decision key and rejects production claims',async()=>{
  const f=fixture(),vault=f.vault();await vault.identify('tenant/agent');
  const attempt={key:id(4),attachmentId:id(3),body:{expectedDraftRevision:2,expectedReviewRevision:0,
    decision:'NEEDS_CORRECTION',reason:'BLURRY'}};
  await vault.write('review:'+id(1),JSON.stringify(evidenceReviewAttemptSchema.parse(attempt)));
  const fresh=f.vault();await fresh.identify('tenant/agent');
  assert.deepEqual(evidenceReviewAttemptSchema.parse(JSON.parse(await fresh.read('review:'+id(1)))),attempt);
  assert.throws(()=>evidenceReviewAttemptSchema.parse({...attempt,productionApproved:true}));
  assert.throws(()=>evidenceReviewAttemptSchema.parse({...attempt,body:{...attempt.body,decision:'ACCEPTED_SAMPLE'}}));
});
