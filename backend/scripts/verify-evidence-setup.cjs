// Synthetic hosted checks only. No Auth/profile/domain writes, no secret output.
// Run from backend: node --env-file=.env scripts/verify-evidence-setup.cjs
const {Pool}=require('pg');const {createClient}=require('@supabase/supabase-js');
const {randomUUID}=require('node:crypto');const fs=require('node:fs/promises');const path=require('node:path');
const {evidenceCipher,evidenceInput,SupabaseEvidenceStorage,EVIDENCE_BUCKET}=require('../dist/evidence');
async function main() {
  const env=process.env;
  const result={storageSecretPresent:!!env.SUPABASE_STORAGE_SECRET_KEY?.trim(),
    storageSecretFormatValid:!!env.SUPABASE_STORAGE_SECRET_KEY?.trim().startsWith('sb_secret_'),
    encryptionKeyValid:/^[0-9a-f]{64}$/i.test(env.ENROLLMENT_EVIDENCE_KEY_HEX||''),
    developmentEnvironment:env.NODE_ENV==='development'};
  if(!Object.values(result).every(Boolean)){console.log(JSON.stringify(result));process.exitCode=1;return;}
  const pool=new Pool({connectionString:env.DATABASE_URL,max:1,connectionTimeoutMillis:10000,query_timeout:10000});
  let stage='database checks',client,probePath,privileged,probeCreated=false;
  try {
    client=await pool.connect();
    result.databaseTLSVerified=client.connection.stream.encrypted===true && client.connection.stream.authorized===true;
    const roles=await client.query('select rolsuper,rolbypassrls from pg_roles where rolname=current_user');
    result.databaseRoleRestricted=roles.rows.length===1 && !roles.rows[0].rolsuper && !roles.rows[0].rolbypassrls;
    const tables=await client.query("select c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('enrollment_attachments','enrollment_attachment_events')");
    result.attachmentTablesProtected=tables.rows.length===2 && tables.rows.every(r=>r.relrowsecurity&&r.relforcerowsecurity);
    const functions=await client.query("select p.oid,has_function_privilege('autoguardian_enrollment_api',p.oid,'EXECUTE') api,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,has_function_privilege('service_role',p.oid,'EXECUTE') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('enrollment_attachment_list','enrollment_attachment_reserve','enrollment_attachment_finish','enrollment_attachment_read')");
    result.attachmentFunctionsRestricted=functions.rows.length===4 && functions.rows.every(r=>r.api&&!r.anon&&!r.authenticated&&!r.service);
    const policies=await client.query("select permissive,roles,cmd from pg_policies where schemaname='storage' and tablename='objects' and policyname='development_evidence_no_client_access'");
    result.clientDenyPolicyInstalled=policies.rows.length===1 && policies.rows[0].permissive==='RESTRICTIVE' && policies.rows[0].cmd==='ALL' && policies.rows[0].roles.includes('public');
    client.release();client=undefined;
    if(!Object.values(result).every(Boolean)){result.failedStage=stage;process.exitCode=1;return;}
    stage='private bucket and storage authentication';
    const storage=new SupabaseEvidenceStorage(env.SUPABASE_URL,env.SUPABASE_STORAGE_SECRET_KEY.trim());
    await storage.check();result.privateBucketVerified=true;
    stage='synthetic encryption round trip';
    const raw=await fs.readFile(path.resolve(__dirname,'../../.tools/upload-samples/sample-owner-document.jpg'));
    const input=await evidenceInput({kind:'OWNER_ID',dataBase64:raw.toString('base64')});
    const row={tenant_id:env.AUTOGUARDIAN_TENANT_ID,draft_id:randomUUID(),owner_profile_id:randomUUID(),id:randomUUID(),
      kind:input.kind,mime_type:input.mime,byte_size:input.bytes.length,sha256:input.sha};
    probePath=row.tenant_id+'/'+row.draft_id+'/'+row.id+'.agenc';
    const cipher=evidenceCipher(Buffer.from(env.ENROLLMENT_EVIDENCE_KEY_HEX,'hex'));
    const ciphertext=cipher.encrypt(input.bytes,row);await storage.put(probePath,ciphertext);probeCreated=true;
    const stored=await storage.get(probePath);
    result.storedObjectIsCiphertext=stored.equals(ciphertext) && !stored.equals(input.bytes);
    result.encryptedRoundTripVerified=cipher.decrypt(stored,row).equals(input.bytes);
    stage='anonymous access denial';
    const anonymous=createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},
      global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(8000)})}});
    const read=await anonymous.storage.from(EVIDENCE_BUCKET).download(probePath);
    result.anonymousDownloadDenied=!!read.error&&!read.data;
    const publicUrl=anonymous.storage.from(EVIDENCE_BUCKET).getPublicUrl(probePath).data.publicUrl;
    const publicRead=await fetch(publicUrl,{signal:AbortSignal.timeout(8000)});
    result.publicDownloadDenied=!publicRead.ok;await publicRead.body?.cancel();
    if(!Object.values(result).every(Boolean))process.exitCode=1;
  } catch {result.failedStage=stage;process.exitCode=1;}
  finally {
    client?.release();await pool.end();
    if(probeCreated) {
      privileged=createClient(env.SUPABASE_URL,env.SUPABASE_STORAGE_SECRET_KEY.trim(),{auth:{persistSession:false,autoRefreshToken:false},
        global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(8000)})}});
      try {const cleanup=await privileged.storage.from(EVIDENCE_BUCKET).remove([probePath]);result.syntheticProbeRemoved=!cleanup.error;}
      catch {result.syntheticProbeRemoved=false;}
      if(!result.syntheticProbeRemoved)process.exitCode=1;
    }
    console.log(JSON.stringify(result));
  }
}
void main().catch(()=>{console.error('Verification did not finish; no credentials were printed.');process.exitCode=1;});
