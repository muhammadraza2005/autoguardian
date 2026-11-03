const {test}=require('node:test'),assert=require('node:assert/strict');
const {configuredReportEvidence}=require('../dist/checks'),sharp=require('sharp');
const {telecomFixture,id}=require('./helpers/telecom-fixture.cjs');
const {PostgresWorkflowStore}=require('../dist/checks');
test('report evidence key rotation preserves legacy/old versions and binds version labels to authenticated encryption',async()=>{
 const f=await telecomFixture();try{
  const store=new PostgresWorkflowStore(f.pool,id(10));
  const report=await f.as(2,()=>store.call(id(2),'submit_vehicle_report',[id(501),id(800),'missing','2026-01-01T00:00:00Z','Synthetic report reason']));
  const bytes=await sharp({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer(),input={kind:'VEHICLE_PHOTO',dataBase64:bytes.toString('base64')};
  const legacy='01'.repeat(32),v1='02'.repeat(32),v2='03'.repeat(32);
  const legacyService=configuredReportEvidence({AUTOGUARDIAN_REPORT_EVIDENCE_KEY:legacy},store);
  const a=await f.as(2,()=>legacyService.upload(id(2),report.id,id(801),input));
  const ring=(active,keys)=>({AUTOGUARDIAN_REPORT_EVIDENCE_KEY:legacy,AUTOGUARDIAN_REPORT_EVIDENCE_ACTIVE_KEY:active,AUTOGUARDIAN_REPORT_EVIDENCE_KEYS_JSON:JSON.stringify(keys)});
  const first=configuredReportEvidence(ring('v1',{v1}),store),b=await f.as(2,()=>first.upload(id(2),report.id,id(802),input));
  const rotated=configuredReportEvidence(ring('v2',{v1,v2}),store);
  const c=await f.as(2,()=>rotated.upload(id(2),report.id,id(803),input));
  for(const file of [a,b,c])assert.equal((await f.as(2,()=>rotated.read(id(2),file.id,false))).mimeType,'image/jpeg');
  const missing=configuredReportEvidence(ring('v2',{v2}),store);await assert.rejects(f.as(2,()=>missing.read(id(2),b.id,false)),e=>e.getResponse().code==='REPORT_EVIDENCE_UNAVAILABLE');
  await f.db.query("update private.vehicle_report_evidence set ciphertext=replace(ciphertext,'v2:v1:','v2:v2:') where id=$1",[b.id]);
  await assert.rejects(f.as(2,()=>rotated.read(id(2),b.id,false)),e=>e.getResponse().code==='REPORT_EVIDENCE_UNAVAILABLE');
  assert.throws(()=>configuredReportEvidence(ring('absent',{v1}),store));
 }finally{await f.db.close();}
});
