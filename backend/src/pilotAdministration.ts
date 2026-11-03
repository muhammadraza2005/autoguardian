import {BadRequestException,Body,ConflictException,Controller,ForbiddenException,Get,Headers,HttpCode,Inject,NotFoundException,Post,Query,ServiceUnavailableException} from '@nestjs/common';
import type {Pool} from 'pg';
import type {IdentityVerifier} from './auth';
import {draftId} from './enrollments';
import {setRequestIdentity} from './requestIdentity';

export const pilotSections=['organizations','agents','seals','configuration','history'] as const;
const actions=['ORGANIZATION_STATUS','AGENT_STATUS','SEAL_ALLOCATE','SEAL_RECONCILE','CONFIGURE'];
function invalid():never {throw new BadRequestException({code:'INVALID_ADMIN_INPUT'});}
function object(value:unknown,keys:string[]) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k)))return invalid();
  return value as Record<string,unknown>;
}
function text(value:unknown,min:number,max:number,multiline=false) {
  const controls=multiline?/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/;
  if(typeof value!=='string'||value.trim().length<min||value.trim().length>max||controls.test(value))return invalid();
  return value.trim();
}
export function pilotChangeInput(body:unknown) {
  const b=object(body,['action','targetId','expectedRevision','payload']);
  if(typeof b.action!=='string'||!actions.includes(b.action)||!Number.isInteger(b.expectedRevision)||Number(b.expectedRevision)<0||Number(b.expectedRevision)>=2147483647)return invalid();
  let payload:Record<string,unknown>;
  if(b.action==='CONFIGURE') {
    payload=object(b.payload,['enabled','incidentPolicyEn','incidentPolicyFr','emergencyContact']);
    if(typeof payload.enabled!=='boolean')return invalid();
    payload={enabled:payload.enabled,incidentPolicyEn:text(payload.incidentPolicyEn,20,2000,true),incidentPolicyFr:text(payload.incidentPolicyFr,20,2000,true),emergencyContact:payload.emergencyContact===null?null:text(payload.emergencyContact,3,100)};
  } else if(b.action==='SEAL_ALLOCATE') {
    payload=object(b.payload,['agentId','organizationId','reason']);
    payload={agentId:draftId(payload.agentId),organizationId:draftId(payload.organizationId),reason:text(payload.reason,3,500)};
  } else if(b.action==='SEAL_RECONCILE') {
    payload=object(b.payload,['observedCount','origin','reason']);
    if(!Number.isInteger(payload.observedCount)||Number(payload.observedCount)<0||Number(payload.observedCount)>1000000||!['DEVELOPMENT','PRODUCTION'].includes(String(payload.origin)))return invalid();
    payload={observedCount:payload.observedCount,origin:payload.origin,reason:text(payload.reason,3,500)};
  } else {
    payload=object(b.payload,['status','reason']);
    if(!['ACTIVE','SUSPENDED',...(b.action==='AGENT_STATUS'?['REVOKED']:[])].includes(String(payload.status)))return invalid();
    payload={status:payload.status,reason:text(payload.reason,3,500)};
  }
  return {action:b.action,targetId:draftId(b.targetId),expectedRevision:Number(b.expectedRevision),payload};
}
export class PilotAdministrationService {
  constructor(private readonly pool:Pool,private readonly tenant:string){}
  read(actor:string,section:string,limit:number,offset:number) {return this.call(actor,'pilot_read',[section,limit,offset]);}
  change(actor:string,key:string,body:unknown) {const b=pilotChangeInput(body);return this.call(actor,'pilot_change',[draftId(key),b.action,b.targetId,b.expectedRevision,JSON.stringify(b.payload)]);}
  private async call(actor:string,name:'pilot_read'|'pilot_change',args:unknown[]) {
    const client=await this.pool.connect();
    try {
      await client.query('begin isolation level serializable');await client.query('set local role autoguardian_enrollment_api');
      await setRequestIdentity(client,this.tenant,actor);
      const result=await client.query(`select private.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args);
      await client.query('commit');return result.rows[0].result;
    }catch(error){
      await client.query('rollback');const code=(error as {code?:string}).code??'';
      if(['AG400','22P02','23514'].includes(code))throw new BadRequestException({code:'INVALID_ADMIN_INPUT'});
      if(code==='AG403'||code==='42501')throw new ForbiddenException({code:'TENANT_ADMIN_REQUIRED'});
      if(code==='AG404')throw new NotFoundException({code:'ADMIN_ITEM_NOT_FOUND'});
      if(['AG409','23505','40001','40P01'].includes(code))throw new ConflictException({code:'ADMIN_ITEM_CHANGED'});
      if(['42883','42P01','42703'].includes(code))throw new ServiceUnavailableException({code:'ADMIN_SETUP_REQUIRED'});
      throw error;
    }finally{client.release();}
  }
}
@Controller('pilot-administration')
export class PilotAdministrationController {
  constructor(@Inject('PILOT_AUTH') private readonly auth:IdentityVerifier,@Inject('PILOT_ADMINISTRATION') private readonly service:PilotAdministrationService){}
  @Get() async read(@Headers('authorization') h:string|undefined,@Query() q:Record<string,unknown>) {
    const actor=await this.auth.verify(h);
    if(Object.keys(q).some(k=>!['section','limit','offset'].includes(k))||!pilotSections.includes(q.section as typeof pilotSections[number]))return invalid();
    for(const k of ['limit','offset'])if(q[k]!==undefined&&(typeof q[k]!=='string'||!/^\d+$/.test(q[k] as string)))return invalid();
    const limit=q.limit===undefined?20:Number(q.limit),offset=q.offset===undefined?0:Number(q.offset);
    if(!Number.isInteger(limit)||limit<1||limit>50||!Number.isInteger(offset)||offset<0||offset>2147483647)return invalid();
    return this.service.read(actor,q.section as string,limit,offset);
  }
  @Post() @HttpCode(200) async change(@Headers('authorization') h:string|undefined,@Headers('idempotency-key') key:string|undefined,@Body() b:unknown,@Query() q:Record<string,unknown>) {
    const actor=await this.auth.verify(h);if(Object.keys(q).length)return invalid();return this.service.change(actor,draftId(key),b);
  }
}
