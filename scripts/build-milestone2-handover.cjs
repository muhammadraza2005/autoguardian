// Explicit installation-kit inputs only. Never includes the real .env or source secrets.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),name='milestone-2-africastalking-handover-2026-10-22',directory=path.join(root,'output',name),archive=directory+'.zip';
const files=[
 'supabase/preflight-milestone2-telecom.sql',
 'supabase/migrations/202610130026_billing_operations.sql',
 'supabase/migrations/202610210027_africastalking_sms.sql',
 'supabase/migrations/202610210028_telecom_channels.sql',
 'supabase/migrations/202610220029_owner_pin_step_up.sql',
 'supabase/verify-billing-operations.sql','supabase/verify-africastalking-telecom.sql','supabase/verify-owner-pin.sql',
 'supabase/verify-twilio-sms-delivery.sql','supabase/verify-milestone2-workflows.sql',
 'backend/.env.example','backend/scripts/check-telecom-setup.cjs',
 'docs/AFRICAS-TALKING-SETUP.md','docs/OWNER-PIN-SETUP.md','docs/MILESTONE2-AFRICAS-TALKING-HANDOVER.md',
 'milestone-2.md','output/telecom-validation.json','output/telecom-hosted-inventory.json',
 'output/telecom-dependency-audit.json','output/mobile-dependency-audit.json',
 'output/telecom-backend-tests-final.tap','output/telecom-mobile-tests.tap',
 'output/telecom-mobile-checks.log','output/telecom-web-export.log','output/telecom-android-export.log'
];
fs.mkdirSync(directory,{recursive:true});
const manifest=files.map(relative=>{
 const source=path.join(root,relative),destination=path.join(directory,relative);
 fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(source,destination);
 return {path:relative,sha256:createHash('sha256').update(fs.readFileSync(destination)).digest('hex')};
});
fs.writeFileSync(path.join(directory,'START-HERE.md'),`# Milestone 2 installation handover — 22 October 2026

Start with docs/MILESTONE2-AFRICAS-TALKING-HANDOVER.md.

1. Run supabase/preflight-milestone2-telecom.sql and check hosted migration history.
2. On the inspected project, 024/025 are already present. Apply only missing SQL:
   026 billing operations -> 027 Africa's Talking SMS -> 028 channels -> 029 owner PIN.
3. Run the supplied verifiers using a schema-owner connection, not the runtime login.
4. Configure provider resources, trusted ingress, Supabase hook and approved PIN policy.
5. Accept actual simulator/handset journeys before production release.

This is an installation/documentation kit for the current AutoGuardian workspace,
not a standalone source-code deployment. Repository links in the guides refer to
that workspace. Existing source, earlier migrations and provider access are dependencies.

No real .env, API keys, signing/encryption secrets or phone lists are included.
See output/telecom-validation.json and output/telecom-hosted-inventory.json for
validation and read-only hosted findings. SHA256SUMS.json lists input digests.
`);
fs.writeFileSync(path.join(directory,'SHA256SUMS.json'),JSON.stringify(manifest,null,2)+'\n');
// Built-in ZIP APIs; explicit inputs and portable slash-separated entry names.
// No .ps1 file execution, execution-policy change or filesystem deletion.
const command=`$ErrorActionPreference='Stop';
Add-Type -AssemblyName System.IO.Compression;
Add-Type -AssemblyName System.IO.Compression.FileSystem;
$stream=[System.IO.File]::Open($env:AUTOGUARDIAN_HANDOVER_ZIP,[System.IO.FileMode]::Create);
$zip=[System.IO.Compression.ZipArchive]::new($stream,[System.IO.Compression.ZipArchiveMode]::Create);
try { foreach($relative in (ConvertFrom-Json $env:AUTOGUARDIAN_HANDOVER_FILES)) {
 $source=Join-Path $env:AUTOGUARDIAN_HANDOVER_ROOT $relative;
 $entry=(Split-Path -Leaf $env:AUTOGUARDIAN_HANDOVER_ROOT)+'/'+$relative.Replace('\\','/');
 [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$source,$entry,[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null;
} } finally { $zip.Dispose();$stream.Dispose() }`;
const result=spawnSync('powershell.exe',['-NoProfile','-Command',command],
 {windowsHide:true,encoding:'utf8',env:{...process.env,AUTOGUARDIAN_HANDOVER_ROOT:directory,AUTOGUARDIAN_HANDOVER_ZIP:archive,
 AUTOGUARDIAN_HANDOVER_FILES:JSON.stringify([...files,'START-HERE.md','SHA256SUMS.json'])}});
if(result.status!==0){process.stderr.write(result.stderr||'Archive creation failed.');process.exit(1);}
console.log(`Handover archive: ${archive}\nIncluded inputs: ${files.length}, plus start guide and checksum manifest.`);
