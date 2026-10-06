// Run from backend: node --env-file=.env scripts/prepare-evidence-env.cjs
// Append only new local settings; never print or replace existing credentials.
const fs=require('node:fs');const {randomBytes}=require('node:crypto');
if(process.env.NODE_ENV!=='development')throw new Error('Development environment required.');
if(process.env.ENROLLMENT_EVIDENCE_KEY_HEX && !/^[0-9a-f]{64}$/i.test(process.env.ENROLLMENT_EVIDENCE_KEY_HEX)) {
  throw new Error('Existing evidence key is invalid; it was left unchanged.');
}
let additions='';
if(process.env.SUPABASE_STORAGE_SECRET_KEY===undefined) {
  additions+='\n# Server-only Supabase secret key (sb_secret_...). Paste it here, never in mobile/.env.\nSUPABASE_STORAGE_SECRET_KEY=\n';
}
if(!process.env.ENROLLMENT_EVIDENCE_KEY_HEX) {
  additions+='\n# Generated local evidence encryption key. Preserve this value to recover uploaded files.\nENROLLMENT_EVIDENCE_KEY_HEX='+randomBytes(32).toString('hex')+'\n';
}
if(additions)fs.appendFileSync('.env',additions,{encoding:'utf8'});
console.log('Development upload settings prepared. Existing credentials were preserved.');
console.log(process.env.SUPABASE_STORAGE_SECRET_KEY?.trim()?'Storage key is configured.':'Add the server-only key to SUPABASE_STORAGE_SECRET_KEY in backend/.env, then restart the backend.');
