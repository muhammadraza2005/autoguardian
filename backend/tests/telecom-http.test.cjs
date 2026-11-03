const {test}=require('node:test'),assert=require('node:assert/strict');
const {check}=require('../scripts/check-telecom-http.cjs');
test('HTTP deployment check never sends credentials or recipient data and does not treat disabled routes as working',async()=>{
 const seen=[];
 const run=status=>check('https://api.example.test',async(url,options)=>{seen.push({url:String(url),...options});
  const code=url.pathname==='/v1/health'?200:url.pathname.includes('twilio')?404:status;
  return new Response(code===200?'{}':null,{status:code});});
 assert.equal((await run(404)).passed,false);
 assert.ok(seen.every(r=>!r.headers?.authorization&&!r.headers?.['x-autoguardian-gateway-token']&&(!r.body||r.body==='{}')));
 for(const url of ['http://api.example.test','https://user:secret@api.example.test','https://api.example.test/private','https://api.example.test/?key=secret'])await assert.rejects(check(url));
 const success=await check('http://127.0.0.1:3000',async(url)=>new Response(url.pathname==='/v1/health'?'{"status":"ok"}':null,
  {status:url.pathname==='/v1/health'?200:url.pathname.includes('twilio')?404:403}));
 assert.equal(success.passed,true);
});
