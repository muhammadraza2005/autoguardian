import test from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {createEncryptedVault} from '../src/features/enrollment/encryptedVault.ts';
import {createOfflineAccess,offlineIdentity} from '../src/features/auth/offlineAccess.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const profile={id:id(1),tenantId:id(2),preferredLanguage:'en',roles:[{code:'ENROLLMENT_AGENT',organizationId:id(3)}]};
const identity={authUserId:id(4),sessionId:id(5)};
const lease={tenantId:id(2),actorId:id(1),authUserId:id(4),sessionId:id(5),organizations:[id(3)],policyRevision:1,
 issuedAt:'2026-10-13T10:00:00Z',expiresAt:'2026-10-13T12:00:00Z',readOnly:true};
function fixture(){
 let key=null,time=Date.parse(lease.issuedAt);const files=new Map();
 const io={keyRead:async()=>key,keyWrite:async v=>{key=v;},keyDelete:async()=>{key=null;},read:async n=>files.get(n)??null,
  write:async(n,v)=>{files.set(n,v);},remove:async n=>{files.delete(n);},clear:async()=>{files.clear();}};
 const crypto={hash:async v=>createHash('sha256').update(v).digest('hex'),generate:async()=>randomBytes(32).toString('hex'),
  seal:async(v,k,a)=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',Buffer.from(k,'hex'),iv);c.setAAD(Buffer.from(a));
   const bytes=Buffer.concat([c.update(v),c.final()]);return Buffer.concat([iv,c.getAuthTag(),bytes]).toString('base64');},
  open:async(v,k,a)=>{const b=Buffer.from(v,'base64'),c=createDecipheriv('aes-256-gcm',Buffer.from(k,'hex'),b.subarray(0,12));
   c.setAAD(Buffer.from(a));c.setAuthTag(b.subarray(12,28));return Buffer.concat([c.update(b.subarray(28)),c.final()]).toString();}};
 const make=()=>createOfflineAccess(createEncryptedVault(io,crypto),()=>time);
 return {make,files,advance:ms=>{time+=ms;}};
}
test('cold startup reads only encrypted server-approved identity and expires at its bounded deadline',async()=>{
 const f=fixture(),cache=f.make();assert.equal(await cache.recover(identity),null);
 await cache.save(identity,profile,lease);assert.equal([...f.files.values()].join('').includes('ENROLLMENT_AGENT'),false);
 f.advance(3600000);assert.deepEqual((await f.make().recover(identity)).profile,profile);
 f.advance(3600000);assert.equal(await f.make().recover(identity),null);
});
test('clock rollback, session/account changes and sign-out cannot restore offline authorization',async()=>{
 const f=fixture(),cache=f.make();await cache.save(identity,profile,lease);f.advance(10000);await cache.recover(identity);
 f.advance(-1000);assert.equal(await f.make().recover(identity),null);
 f.advance(1000);await cache.save(identity,profile,lease);
 assert.equal(await f.make().recover({...identity,sessionId:id(6)}),null);
 assert.equal(await f.make().recover(identity),null);
 await cache.save(identity,profile,lease);await cache.clear();assert.equal(await f.make().recover(identity),null);
});
test('tampered ciphertext, mismatched grants, writable policies and excessive validity fail closed',async()=>{
 const f=fixture(),cache=f.make();await cache.save(identity,profile,lease);
 for(const [key,value]of f.files){const bytes=Buffer.from(value,'base64');bytes[30]^=1;f.files.set(key,bytes.toString('base64'));}
 await assert.rejects(f.make().recover(identity));
 await assert.rejects(cache.save(identity,profile,{...lease,actorId:id(10)}));
 await assert.rejects(cache.save(identity,profile,{...lease,organizations:[id(20)]}));
 await assert.rejects(cache.save(identity,profile,{...lease,readOnly:false}));
 await assert.rejects(cache.save(identity,profile,{...lease,expiresAt:'2026-10-17T12:00:00Z'}));
});
test('local token claims are used only to bind the encrypted cache, and malformed identities cannot open it',()=>{
 const payload=Buffer.from(JSON.stringify({sub:id(4),session_id:id(5)})).toString('base64url');
 assert.deepEqual(offlineIdentity('header.'+payload+'.signature',id(4)),identity);
 assert.equal(offlineIdentity('header.'+payload+'.signature',id(9)),null);assert.equal(offlineIdentity('invalid',id(4)),null);
});
