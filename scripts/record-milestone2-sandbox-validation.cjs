// Local evidence summary only. Does not read .env, make network requests or enable services.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function log(relative){const b=fs.readFileSync(path.join(root,relative));return b[0]===255&&b[1]===254?b.toString('utf16le').replace(/^\uFEFF/,''):b.toString('utf8').replace(/^\uFEFF/,'');}
function tests(relative){const text=log(relative),count=label=>{const matches=[...text.matchAll(new RegExp('^# '+label+' (\\d+)\\r?$','gm'))];if(!matches.length)throw new Error('Test log is incomplete: '+relative);return Number(matches.at(-1)[1]);};
 return {log:relative,tests:count('tests'),passed:count('pass'),failed:count('fail')};}
const report={clientDate:'2026-10-23',scope:'Local implementation and automated verification; external provider acceptance is separate.',
 backend:tests('output/telecom-backend-tests-current.tap'),mobile:tests('output/telecom-mobile-tests-current.tap'),
 mobileChecks:{typecheck:'passed',lint:'passed',expoCompatibility:'passed',androidHermesExport:'passed',androidLog:'output/telecom-android-export-current.log'},
 approvedRules:{backup:'Accepted contacts receive alerts only; cannot approve/refuse.',seller:'Specific vehicle; OTP acceptance; maximum 30 days; no check approval.',listingDays:30,pin:{maxAttempts:5,lockSeconds:900,proofSeconds:60}},
 nextMigration:'supabase/migrations/202610220030_vehicle_relationships.sql',verifier:'supabase/verify-vehicle-relationships.sql',
 pending:['Hosted migration 030 (last verified absent).','Africa\u2019s Talking sandbox account credentials and channel resources.','Protected public HTTPS callback configuration.','Hosted Supabase Send SMS Hook.','Provider simulator acceptance.','Real-phone/network tests require production resources.','Authority-configured production price/free allowance; SRS does not specify amounts.','Production security/deployment and client acceptance.'],
 productionEnabledByThisWork:false,providerSimulatorTested:false,realPhoneTested:false,
 deploymentTemplates:{docker:'Prepared; not built here (Docker unavailable).',nginx:'Prepared; deny by default until provider source addresses and token are configured; not run here.'}};
fs.writeFileSync(path.join(root,'output/milestone2-sandbox-validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(report.backend.failed||report.mobile.failed)process.exitCode=1;
