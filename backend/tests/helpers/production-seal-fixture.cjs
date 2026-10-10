const fs=require('node:fs/promises'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {PostgresEnrollmentStore,draftInput}=require('../../dist/enrollments');
const {identityRequest,rememberVerifiedSession}=require('../../dist/requestIdentity');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture(){
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create role autoguardian_identity_login nologin;
 create schema auth;create table auth.users(id uuid primary key,phone text,phone_confirmed_at timestamptz);create table auth.sessions(id uuid primary key,user_id uuid,aal text,factor_id uuid,not_after timestamptz);
 create table auth.mfa_factors(id uuid primary key,user_id uuid,factor_type text,status text);create table auth.mfa_amr_claims(session_id uuid,authentication_method text,updated_at timestamptz);
 alter table auth.sessions enable row level security;alter table auth.mfa_factors enable row level security;alter table auth.mfa_amr_claims enable row level security;`);
 for(const file of (await fs.readdir(path.resolve(__dirname,'../../../supabase/migrations'))).filter(f=>f.endsWith('.sql')).sort()){
  const sql=await fs.readFile(path.resolve(__dirname,'../../../supabase/migrations',file),'utf8');
  try{await db.exec(sql);}catch(e){await db.close();throw new Error(`${file}: ${e.message}; position=${e.position}; ${e.where??''}; ${e.internalQuery??''}; ${e.position?sql.slice(Number(e.position)-150,Number(e.position)+50):''}`);}
 }
 await db.exec(`insert into auth.users values('${id(1)}'),('${id(2)}'),('${id(3)}');
 insert into app.tenants(id,code,name_en,country_code,currency_code,time_zone) values('${id(10)}','SEAL_TEST','Synthetic authority','CD','USD','Africa/Kinshasa');
 insert into app.users(id,tenant_id,auth_user_id) values('${id(21)}','${id(10)}','${id(1)}'),('${id(22)}','${id(10)}','${id(2)}'),('${id(23)}','${id(10)}','${id(3)}');
 insert into app.organizations(id,tenant_id,type,name) values('${id(30)}','${id(10)}','ASSOCIATION','Synthetic network');
 insert into app.role_assignments(tenant_id,user_id,role_code,organization_id) values('${id(10)}','${id(21)}','ENROLLMENT_AGENT','${id(30)}'),('${id(10)}','${id(22)}','OWNER',null),('${id(10)}','${id(23)}','TENANT_ADMIN',null);
 insert into app.agent_accreditations(tenant_id,organization_id,user_id) values('${id(10)}','${id(30)}','${id(21)}');
 insert into private.owners(id,tenant_id,user_id,kind,legal_name) values('${id(40)}','${id(10)}','${id(22)}','PERSON','Synthetic owner');
 insert into private.production_enrollment_owners values('${id(10)}','${id(30)}','${id(22)}','Owner reference',true);
 insert into private.registration_access_configuration(tenant_id,production_enabled) values('${id(10)}',true);
 insert into auth.mfa_factors values('${id(51)}','${id(1)}','totp','verified'),('${id(53)}','${id(3)}','totp','verified');
 insert into auth.sessions values('${id(61)}','${id(1)}','aal2','${id(51)}',now()+interval '2 hours'),('${id(63)}','${id(3)}','aal2','${id(53)}',now()+interval '2 hours'),('${id(62)}','${id(2)}','aal1',null,now()+interval '2 hours');
 insert into auth.mfa_amr_claims values('${id(61)}','password',now()),('${id(61)}','totp',now()),('${id(63)}','password',now()),('${id(63)}','totp',now());`);
 const pool={connect:async()=>({query:async(sql,values)=>{const r=await db.query(sql,values);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};},release(){}})};
 function as(n,call){return new Promise((resolve,reject)=>identityRequest(()=>{
  rememberVerifiedSession({authUserId:id(n),sessionId:id(60+n),expiresAt:Date.now()/1000+300,staff:n!==2});Promise.resolve().then(call).then(resolve,reject);
 }));}
 const drafts=new PostgresEnrollmentStore(pool,id(10),true),input=draftInput({organizationId:id(30),ownerProfileId:id(22),vehicle:{chassisIdentifier:'SEAL-SYNTHETIC',category:'CAR'}});
 const draft=(await as(1,()=>drafts.save(id(1),input,undefined,id(90)))).draft;
 return {db,pool,as,draft,drafts,input};
}
module.exports={fixture,id};
