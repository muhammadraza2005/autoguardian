import {BadRequestException,ForbiddenException} from '@nestjs/common';
import {createHash,randomInt,randomUUID} from 'node:crypto';
import {PostgresWorkflowStore,fields} from './checks';
import {draftId} from './enrollments';
import {phonePattern} from './sms';
import {DurableTelecomSender,TelecomCipher} from './telecomStore';

export class RelationshipService {
 constructor(private readonly store:PostgresWorkflowStore,private readonly cipher:TelecomCipher,
  private readonly sender:DurableTelecomSender,private readonly code=()=>String(randomInt(100000,1000000))){}
 list(actor:string){return this.store.call(actor,'relationship_list',[]);}
 async invite(actor:string,id:string,value:unknown){
  const v=fields(value,['vehicleId','kind','phone','proof'],['vehicleId','kind','phone']);
  if(!['backup','seller'].includes(String(v.kind))||typeof v.phone!=='string'||!phonePattern.test(v.phone)
   ||v.proof!==undefined&&(typeof v.proof!=='string'||!/^[a-f0-9]{64}$/.test(v.proof)))throw new BadRequestException({code:'INVALID_RELATIONSHIP'});
  const result=await this.store.call(actor,'relationship_invite',[draftId(id),draftId(v.vehicleId),v.kind,createHash('sha256').update(v.phone).digest('hex')],v.proof as string|undefined);
  await this.sender.send({key:`relationship-invite:${id}`,phone:v.phone,
   body:v.kind==='backup'?'AutoGuardian TEST: backup alert invitation. Open the app to review and accept by SMS code. This does not allow sale approval.'
    :'AutoGuardian TEST: vehicle seller invitation, maximum 30 days. Open the app to review and accept by SMS code. No sale approval rights.'});
  return result;
 }
 async start(actor:string,id:string,value:unknown){
  const v=fields(value,['consentVersion','accept']);
  if(v.consentVersion!=='alert-only-v1'||v.accept!==true)throw new BadRequestException({code:'RELATIONSHIP_CONSENT_REQUIRED'});
  const challengeId=randomUUID(),code=this.code();
  const result=await this.store.call<{phone:string}>(actor,'relationship_start_acceptance',[draftId(id),challengeId,this.cipher.hash(['relationship',challengeId,code])]);
  await this.sender.send({key:`relationship-accept:${challengeId}`,phone:result.phone,
   body:`AutoGuardian TEST: ${code}. Confirm the invitation in the app. Ne partagez pas. Valid 3 min.`});
  return {challengeId};
 }
 async confirm(actor:string,value:unknown){
  const v=fields(value,['challengeId','code']);
  if(typeof v.code!=='string'||!/^\d{6}$/.test(v.code))throw new BadRequestException({code:'INVALID_RELATIONSHIP_CODE'});
  const challenge=draftId(v.challengeId);
  if(!await this.store.call(actor,'relationship_finish_acceptance',[challenge,this.cipher.hash(['relationship',challenge,v.code])]))
   throw new ForbiddenException({code:'RELATIONSHIP_CODE_INVALID'});
  return {accepted:true};
 }
 revoke(actor:string,id:string){return this.store.call(actor,'relationship_revoke',[draftId(id)]);}
}
