import test from 'node:test';import assert from 'node:assert/strict';
import {parseFittingCode,sealValidationSchema,sealIssues,blockingSealIssues} from '../src/features/enrollment/sealValidation.ts';
import {validateSealFitting} from '../src/features/enrollment/seals.ts';
import {sealEn,sealFr} from '../src/i18n/sealResources.ts';
const id='00000000-0000-4000-8000-000000000001';
const pending={version:1,required:true,complete:false,physicalVerified:false,issues:[],
  slots:[1,2,3,4].map(position=>({position,issues:['SEAL_REQUIRED','PHOTO_REQUIRED']}))};
test('fitting scan accepts a normalized development code and refuses links or consumer tokens',()=>{
  assert.equal(parseFittingCode(' dev-seal-std-001 '),'DEV-SEAL-STD-001');
  for(const value of ['https://example.test/DEV-SEAL-STD-001','AG1.signed-token','DEV-SEAL-','DEV-SEAL-'+('A'.repeat(41)),
    '{"code":"DEV-SEAL-STD-001"}','DEV-SEAL-A\nDEV-SEAL-B'])assert.equal(parseFittingCode(value),null);
});
test('validation cannot claim physical verification or completeness with failed/duplicate/missing positions',()=>{
  assert.equal(sealValidationSchema.parse(pending).complete,false);assert.equal(blockingSealIssues(pending),false);
  const rejected={...pending,slots:pending.slots.map(s=>s.position===1?{...s,issues:['DUPLICATE_PHOTO']}:s)};
  assert.equal(blockingSealIssues(rejected),true);
  for(const change of [{complete:true},{physicalVerified:true},{version:0},{slots:pending.slots.slice(1)},
    {slots:[pending.slots[0],...pending.slots.slice(0,3)]},{required:false},
    {slots:pending.slots.map(s=>({...s,issues:['PHOTO_REQUIRED','PHOTO_REQUIRED']}))}])
    assert.throws(()=>sealValidationSchema.parse({...pending,...change}));
  const sanitized=sealValidationSchema.parse({...pending,sealCode:'private',photoId:'private',sha256:'private'});
  assert.ok(!JSON.stringify(sanitized).includes('private'));
});
test('checking is a scoped read-only POST bound to both revisions; duplicate choices reach diagnostics without a save key',async()=>{
  const body={package:'STANDARD',expectedDraftRevision:3,expectedFittingRevision:2,
    placements:[{position:2,sealCode:'DEV-SEAL-STD-001',photoId:null},{position:1,sealCode:'DEV-SEAL-STD-001',photoId:null}]};
  const result={draftId:id,draftRevision:3,fittingRevision:2,sealValidation:pending};
  await validateSealFitting(async(path,options)=>{
    assert.equal(path,'/v1/enrollment-drafts/'+id+'/seals/validate');assert.equal(options.method,'POST');
    assert.equal(options.idempotencyKey,undefined);assert.deepEqual(options.body.placements.map(s=>s.position),[1,2]);return result;
  },id,body);
  for(const patch of [{draftId:'00000000-0000-4000-8000-000000000002'},{draftRevision:4},{fittingRevision:3},
    {sealValidation:{...pending,issues:['STALE_FITTING']}}])
    await assert.rejects(validateSealFitting(async()=>({...result,...patch}),id,body));
  await assert.rejects(validateSealFitting(async()=>{throw new Error('No access');},id,body),/No access/);
});
test('every fitting diagnostic has English and French messages',()=>{
  for(const language of [sealEn,sealFr])for(const code of [...sealIssues,'PACKAGE_REQUIRED','STALE_FITTING'])
    assert.ok(language.validation.issues[code]);
});
