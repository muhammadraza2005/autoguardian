import {z} from 'zod';
import {profileSchema,type AccountProfile} from './profile.ts';
import type {createEncryptedVault} from '../enrollment/encryptedVault.ts';

export const offlineLeaseSchema=z.object({tenantId:z.uuid(),actorId:z.uuid(),authUserId:z.uuid(),sessionId:z.uuid(),
 organizations:z.array(z.uuid()).min(1).max(100),policyRevision:z.number().int().positive(),issuedAt:z.string().datetime({offset:true}),
 expiresAt:z.string().datetime({offset:true}),readOnly:z.literal(true)}).strict();
const cached=z.object({lease:offlineLeaseSchema,profile:profileSchema,sessionId:z.uuid(),savedAt:z.number().finite(),lastSeen:z.number().finite()}).strict();
type Identity={authUserId:string;sessionId:string};
export function offlineIdentity(accessToken:string,authUserId:string):Identity|null{
 try{const payload=JSON.parse(atob(accessToken.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
  if(payload.sub!==authUserId||!z.uuid().safeParse(payload.session_id).success)return null;
  return {authUserId,sessionId:payload.session_id};
 }catch{return null;}
}
export function createOfflineAccess(vault:ReturnType<typeof createEncryptedVault>,now:()=>number=Date.now){
 const record='server-authorized-offline-access';
 async function identify(identity:Identity){await vault.identify(JSON.stringify(['offline-access-v1',identity.authUserId,identity.sessionId]));}
 function valid(value:z.infer<typeof cached>,identity:Identity,time:number){
  const {lease,profile}=value,ttl=Date.parse(lease.expiresAt)-Date.parse(lease.issuedAt);
  return lease.authUserId===identity.authUserId&&lease.sessionId===identity.sessionId&&value.sessionId===identity.sessionId
   &&lease.tenantId===profile.tenantId&&lease.actorId===profile.id&&ttl>0&&ttl<=72*3600000
   &&time>=value.lastSeen&&time>=value.savedAt&&time<value.savedAt+ttl
   &&lease.organizations.every(org=>profile.roles.some(r=>r.code==='ENROLLMENT_AGENT'&&r.organizationId===org));
 }
 return {
  async save(identity:Identity,profile:AccountProfile,lease:unknown){
   await identify(identity);if(lease===null){await vault.remove(record);return;}
   const parsed=offlineLeaseSchema.parse(lease),time=now();
   const value=cached.parse({lease:parsed,profile,sessionId:identity.sessionId,savedAt:time,lastSeen:time});
   if(!valid(value,identity,time))throw new Error('Invalid offline access.');
   await vault.write(record,JSON.stringify(value));
  },
  async recover(identity:Identity){
   await identify(identity);const raw=await vault.read(record);if(!raw)return null;
   const value=cached.parse(JSON.parse(raw)),time=now();
   if(!valid(value,identity,time)){await vault.remove(record);return null;}
   await vault.write(record,JSON.stringify({...value,lastSeen:time}));
   return {profile:value.profile,expiresAt:value.savedAt+Date.parse(value.lease.expiresAt)-Date.parse(value.lease.issuedAt)};
  },
  clear:()=>vault.clear(),
 };
}
// A cached record authorizes local read-only recovery. It is never a server
// bearer token, a grant of app sections or proof of current accreditation.
