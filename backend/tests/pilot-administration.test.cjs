const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture,id}=require('./helpers/production-seal-fixture.cjs');
const {PilotAdministrationService,pilotChangeInput}=require('../dist/pilotAdministration');
const {createApp}=require('../dist/app');
const {UnauthorizedException}=require('@nestjs/common');
const {rememberVerifiedSession}=require('../dist/requestIdentity');
const change=(action,targetId,expectedRevision,payload)=>({action,targetId,expectedRevision,payload});
test('pilot admin rejects overposting, role grants, invalid quotas and configuration',()=>{
 for(const body of [change('GRANT_ROLE',id(21),1,{role:'TENANT_ADMIN'}),{...change('AGENT_STATUS',id(21),1,{status:'ACTIVE',reason:'Reviewed'}),admin:true},
 change('SEAL_RECONCILE',id(30),1,{observedCount:-1,origin:'PRODUCTION',reason:'Physical count'}),change('CONFIGURE',id(10),0,{enabled:true,incidentPolicyEn:'short',incidentPolicyFr:'short',emergencyContact:null}),
 change('ORGANIZATION_STATUS',id(30),1,{status:'REVOKED',reason:'Reviewed'})])assert.throws(()=>pilotChangeInput(body));
 assert.equal(pilotChangeInput(change('CONFIGURE',id(10),0,{enabled:false,incidentPolicyEn:'Review each report independently.\nRetain its audit history.',incidentPolicyFr:'Examiner chaque signalement.\nConserver son historique.',emergencyContact:null})).payload.enabled,false);
});
test('pilot administration uses MFA tenant admin, revision guards, immutable audit and idempotent status transitions',async()=>{
 const f=await fixture();try{
 const service=new PilotAdministrationService(f.pool,id(10));
 await assert.rejects(f.as(1,()=>service.read(id(1),'organizations',20,0)),e=>e.status===403);
 await assert.rejects(f.as(2,()=>service.read(id(2),'organizations',20,0)),e=>e.status===403);
 const queue=await f.as(3,()=>service.read(id(3),'organizations',20,0));assert.equal(queue.items.length,1);assert.equal(queue.items[0].name,'Synthetic network');
 assert.equal(JSON.stringify(queue).includes('Synthetic owner'),false);
 const b=change('ORGANIZATION_STATUS',id(30),1,{status:'SUSPENDED',reason:'Review pending'});
 const result=await f.as(3,()=>service.change(id(3),id(110),b));assert.equal(result.revision,2);
 assert.deepEqual(await f.as(3,()=>service.change(id(3),id(110),b)),result);
 await assert.rejects(f.as(3,()=>service.change(id(3),id(111),b)),e=>e.status===409);
 await assert.rejects(f.as(3,()=>service.change(id(3),id(110),{...b,payload:{status:'ACTIVE',reason:'Changed'}})),e=>e.status===409);
 const history=await f.as(3,()=>service.read(id(3),'history',20,0));assert.equal(history.items.length,1);
 await assert.rejects(f.db.exec(`update private.pilot_admin_events set action='OTHER'`),e=>e.code==='AG403');
 await f.db.exec(`update auth.sessions set aal='aal1' where id='${id(63)}'`);
 await assert.rejects(f.as(3,()=>service.read(id(3),'history',20,0)),e=>e.status===403);
 }finally{await f.db.close();}
});
test('pilot configuration is versioned, unconfigured by default and cannot change production access',async()=>{
 const f=await fixture();try{
 const service=new PilotAdministrationService(f.pool,id(10));
 assert.deepEqual((await f.as(3,()=>service.read(id(3),'configuration',20,0))).items,[]);
 const b=change('CONFIGURE',id(10),0,{enabled:false,incidentPolicyEn:'Review reports independently before accepting them.',incidentPolicyFr:'Examiner chaque signalement avant son acceptation.',emergencyContact:null});
 assert.equal((await f.as(3,()=>service.change(id(3),id(112),b))).revision,1);
 await assert.rejects(f.as(3,()=>service.change(id(3),id(113),b)),e=>e.status===409);
 assert.equal((await f.db.query(`select production_enabled from private.registration_access_configuration`)).rows[0].production_enabled,true);
 await assert.rejects(f.as(3,()=>service.change(id(3),id(114),{...b,targetId:id(999)})),e=>e.status===400);
 }finally{await f.db.close();}
});
test('seal allocation respects current accreditation, reservations and physical discrepancies',async()=>{
 const f=await fixture();try{
 const service=new PilotAdministrationService(f.pool,id(10));
 await f.db.exec(`insert into private.development_seal_stock(id,tenant_id,organization_id,assigned_agent_id,code,batch_code,type,origin) values('${id(120)}','${id(10)}','${id(30)}','${id(21)}','AG00000000000000000000000000000120','Physical-batch-1','STANDARD','PRODUCTION');`);
 const b=change('SEAL_ALLOCATE',id(120),1,{agentId:id(21),organizationId:id(30),reason:'Physical handover'});
 assert.equal((await f.as(3,()=>service.change(id(3),id(121),b))).revision,2);
 const c=change('SEAL_RECONCILE',id(30),1,{observedCount:0,origin:'PRODUCTION',reason:'Physical count recorded'});
 const discrepancy=await f.as(3,()=>service.change(id(3),id(122),c));assert.equal(discrepancy.expectedCount,1);assert.equal(discrepancy.discrepancy,-1);
 assert.equal((await f.db.query('select status from private.development_seal_stock')).rows[0].status,'IN_STOCK');
 await f.db.query(`select set_config('autoguardian.tenant_id',$1,false),set_config('autoguardian.auth_user_id',$2,false),set_config('autoguardian.session_id',$3,false),set_config('autoguardian.staff_until',$4,false)`,[id(10),id(1),id(61),String(Date.now()/1000+300)]);
 await f.db.exec(`insert into private.draft_seal_packages(draft_id,tenant_id,organization_id,agent_user_id,owner_profile_id,saved_draft_revision,revision,package)
 values('${f.draft.id}','${id(10)}','${id(30)}','${id(21)}','${id(22)}',1,1,'STANDARD');
 insert into private.draft_seal_placements(tenant_id,draft_id,organization_id,agent_user_id,seal_id,position) values('${id(10)}','${f.draft.id}','${id(30)}','${id(21)}','${id(120)}',1);`);
 await assert.rejects(f.as(3,()=>service.change(id(3),id(125),{...b,expectedRevision:2})),e=>e.status===409);
 assert.equal((await f.as(3,()=>service.change(id(3),id(126),c))).expectedCount,0);
 await f.db.exec(`update private.draft_seal_placements set released_at=now()`);
 await assert.rejects(f.as(3,()=>service.change(id(3),id(127),{...b,expectedRevision:2})),e=>e.status===409);
 assert.equal((await f.as(3,()=>service.change(id(3),id(128),c))).expectedCount,0);
 await f.db.exec(`insert into private.development_seal_stock(id,tenant_id,organization_id,assigned_agent_id,code,batch_code,type,origin) values('${id(129)}','${id(10)}','${id(30)}','${id(21)}','AG00000000000000000000000000000129','Physical-batch-1','STANDARD','PRODUCTION');`);
 const accreditation=(await f.db.query('select id from app.agent_accreditations')).rows[0].id;
 await f.as(3,()=>service.change(id(3),id(123),change('AGENT_STATUS',accreditation,1,{status:'SUSPENDED',reason:'Accreditation review'})));
 await assert.rejects(f.as(3,()=>service.change(id(3),id(124),{...b,targetId:id(129)})),e=>e.status===403);
 }finally{await f.db.close();}
});
test('pilot tenant isolation and protected administrator accreditation cannot be bypassed',async()=>{
 const f=await fixture();try{
 const service=new PilotAdministrationService(f.pool,id(10));
 await f.db.exec(`insert into app.tenants(id,code,name_en,country_code,currency_code,time_zone) values('${id(140)}','OTHER_PILOT','Other authority','CD','USD','Africa/Kinshasa');
 insert into app.organizations(id,tenant_id,name,type) values('${id(141)}','${id(140)}','Other organization','OTHER');
 insert into app.agent_accreditations(id,tenant_id,user_id,organization_id) values('${id(142)}','${id(10)}','${id(23)}','${id(30)}');`);
 assert.equal((await f.as(3,()=>service.read(id(3),'organizations',20,0))).items.some(i=>i.id===id(141)),false);
 await assert.rejects(f.as(3,()=>service.change(id(3),id(143),change('ORGANIZATION_STATUS',id(141),1,{status:'SUSPENDED',reason:'Denied scope'}))),e=>e.status===404);
 await assert.rejects(f.as(3,()=>service.change(id(3),id(144),change('AGENT_STATUS',id(142),1,{status:'SUSPENDED',reason:'Protected account'}))),e=>e.status===403);
 const other=new PilotAdministrationService(f.pool,id(140));
 await assert.rejects(f.as(3,()=>other.read(id(3),'organizations',20,0)),e=>e.status===403);
 await assert.rejects(f.db.exec('set role autoguardian_enrollment_api; select * from private.pilot_admin_events'),e=>e.code==='42501');
 await f.db.exec('reset role');
 }finally{await f.db.close();}
});
test('pilot HTTP API authenticates before parsing and accepts only scoped validated commands',async()=>{
 const f=await fixture();let app;try{
 const auth={verify:async header=>{if(header!=='Bearer admin')throw new UnauthorizedException({code:'AUTH_REQUIRED'});rememberVerifiedSession({authUserId:id(3),sessionId:id(63),expiresAt:Date.now()/1000+300,staff:true});return id(3);}};
 app=await createApp(auth,{load:async()=>({})},undefined,undefined,undefined,undefined,undefined,undefined,undefined,{auth,service:new PilotAdministrationService(f.pool,id(10))});
 await app.listen(0,'127.0.0.1');const base=await app.getUrl();
 assert.equal((await fetch(base+'/v1/pilot-administration?section=organizations')).status,401);
 const headers={authorization:'Bearer admin','content-type':'application/json','idempotency-key':id(145)};
 let response=await fetch(base+'/v1/pilot-administration?section=organizations',{headers});assert.equal(response.status,200);assert.equal((await response.json()).items.length,1);
 assert.equal((await fetch(base+'/v1/pilot-administration?section=organizations&tenantId='+id(140),{headers})).status,400);
 assert.equal((await fetch(base+'/v1/pilot-administration?section=organizations&limit=1e2',{headers})).status,400);
 response=await fetch(base+'/v1/pilot-administration',{method:'POST',headers,body:JSON.stringify(change('ORGANIZATION_STATUS',id(30),1,{status:'SUSPENDED',reason:'Reviewed by authority'}))});assert.equal(response.status,200);assert.equal((await response.json()).revision,2);
 assert.equal(response.headers.get('cache-control'),'no-store');
 }finally{if(app)await app.close();await f.db.close();}
});
