// No credentials, phone numbers, OTPs, provider sends or authenticated changes.
// Probes use invalid/empty callbacks to check public rejection paths only.
async function check(base,request=fetch){
 const url=new URL(base);
 if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||
  (url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))
  throw new Error('Use an HTTPS API origin, or HTTP localhost.');
 const probes=[['health','GET','/v1/health',200],['account','GET','/v1/me',[401,403]],
  ['smsReceipt','POST','/v1/webhooks/africastalking/sms/delivery',[401,403]],
  ['inboundSms','POST','/v1/webhooks/africastalking/sms/inbound',[401,403]],
  ['ussd','POST','/v1/webhooks/africastalking/ussd',[401,403]],
  ['ussdEvents','POST','/v1/webhooks/africastalking/ussd/events',[401,403]],
  ['authHook','POST','/v1/webhooks/supabase/send-sms',[400,401,403]],
  ['relationships','GET','/v1/me/vehicle-relationships',[401,403]],
  ['ownerPin','GET','/v1/me/owner-pin',[401,403]],
  ['oldTwilioRoute','POST','/v1/webhooks/twilio/sms/status',404]];
 const results={};
 for(const [name,method,path,expected] of probes){
  try{const response=await request(new URL(path,url),{method,redirect:'manual',signal:AbortSignal.timeout(10000),
   ...(method==='POST'?{headers:{'Content-Type':name==='authHook'?'application/json':'application/x-www-form-urlencoded'},body:name==='authHook'?'{}':''}:{})});
   let passed=(Array.isArray(expected)?expected:[expected]).includes(response.status);
   if(name==='health'&&passed){try{passed=(await response.json()).status==='ok';}catch{passed=false;}}
   else await response.body?.cancel();
   results[name]={status:response.status,passed};
  }catch{results[name]={status:null,passed:false};}
 }
 return {checks:results,passed:Object.values(results).every(r=>r.passed),scope:'Reachability and unauthenticated rejection only; no provider or handset acceptance.'};
}
module.exports={check};
if(require.main===module){check(process.env.AUTOGUARDIAN_API_ORIGIN??'').then(report=>{console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;})
 .catch(()=>{console.error('Configure AUTOGUARDIAN_API_ORIGIN with an HTTPS API origin. No secrets printed.');process.exitCode=1;});}
