import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { Pool } from 'pg';

export const sealPackages=['NONE','STANDARD','ONE_ALARM','FOUR_ALARMS'] as const;
export type SealFittingInput={expectedDraftRevision:number;expectedFittingRevision:number;package:typeof sealPackages[number];
  placements:{position:number;sealCode:string;photoId:string|null}[]};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function sealFittingInput(value:unknown,validateOnly=false):SealFittingInput {
  const invalid=()=>{throw new BadRequestException({code:'INVALID_SEAL_FITTING'});};
  if(!value || typeof value!=='object' || Array.isArray(value)) return invalid();
  const v=value as SealFittingInput;
  if(Object.keys(v).some(k=>!['expectedDraftRevision','expectedFittingRevision','package','placements'].includes(k))
    || !Number.isInteger(v.expectedDraftRevision) || v.expectedDraftRevision<1 || v.expectedDraftRevision>2147483646
    || !Number.isInteger(v.expectedFittingRevision) || v.expectedFittingRevision<0 || v.expectedFittingRevision>2147483646
    || !sealPackages.includes(v.package) || !Array.isArray(v.placements) || v.placements.length>4
    || (v.package==='NONE' && v.placements.length)) return invalid();
  const placements=v.placements.map(p=>{
    if(!p || typeof p!=='object' || Array.isArray(p) || Object.keys(p).some(k=>!['position','sealCode','photoId'].includes(k))
      || !Number.isInteger(p.position) || p.position<1 || p.position>4 || typeof p.sealCode!=='string'
      || (p.photoId!==null && (typeof p.photoId!=='string' || !uuid.test(p.photoId)))) return invalid();
    const sealCode=p.sealCode.trim().toUpperCase();
    if(!/^DEV-SEAL-[A-Z0-9-]{1,40}$/.test(sealCode)) return invalid();
    return {position:p.position,sealCode,photoId:p.photoId?.toLowerCase()??null};
  }).sort((a,b)=>a.position-b.position);
  if(new Set(placements.map(p=>p.position)).size!==placements.length || (!validateOnly && (new Set(placements.map(p=>p.sealCode)).size!==placements.length
    || new Set(placements.flatMap(p=>p.photoId?[p.photoId]:[])).size!==placements.filter(p=>p.photoId).length))) return invalid();
  return {...v,placements};
}
export interface SealStore {
  stock(actor:string,organizationId:string,page:{limit:number;cursor?:string}):Promise<unknown>;
  fitting(actor:string,draftId:string):Promise<unknown>;
  validate(actor:string,draftId:string,input:SealFittingInput):Promise<unknown>;
  save(actor:string,draftId:string,key:string,input:SealFittingInput):Promise<unknown>;
}
export class PostgresSealStore implements SealStore {
  constructor(private readonly pool:Pool,private readonly tenantId:string) {}
  stock(actor:string,organizationId:string,page:{limit:number;cursor?:string}) {
    return this.call(actor,'development_seal_stock_page',[organizationId,page.limit,page.cursor??null]);
  }
  fitting(actor:string,draftId:string) {return this.call(actor,'draft_seal_fitting_read',[draftId]);}
  validate(actor:string,draftId:string,input:SealFittingInput) {
    return this.call(actor,'validate_draft_seal_fitting',[draftId,input.expectedDraftRevision,input.expectedFittingRevision,input.package,JSON.stringify(input.placements)]);
  }
  save(actor:string,draftId:string,key:string,input:SealFittingInput) {
    return this.call(actor,'save_draft_seal_fitting',[draftId,key,input.expectedDraftRevision,input.expectedFittingRevision,input.package,JSON.stringify(input.placements)]);
  }
  private async call(actor:string,fn:string,values:unknown[]) {
    const client=await this.pool.connect();
    try {
      await client.query('begin');await client.query('set local role autoguardian_enrollment_api');
      await client.query(`select set_config('autoguardian.tenant_id',$1,true),set_config('autoguardian.auth_user_id',$2,true)`,[this.tenantId,actor]);
      const allowed=await client.query('select private.enrollment_agent_id(null) as actor');
      if(!allowed.rows[0].actor) throw new ForbiddenException({code:'AGENT_ACCESS_REQUIRED'});
      // fn is selected only by the fixed methods above, never from request data.
      const result=await client.query(`select private.${fn}(${values.map((_,i)=>'$'+(i+1)).join(',')}) as result`,values);
      const value=result.rows[0].result;
      if(fn!=='development_seal_stock_page' && value?.sealValidation?.version!==1)
        throw new ServiceUnavailableException({code:'SEAL_SETUP_REQUIRED'});
      await client.query('commit');return value;
    } catch(error) {
      await client.query('rollback');const e=error as {code?:string;message?:string};
      if(e.code==='AG403')throw new ForbiddenException({code:'AGENT_ACCESS_REQUIRED'});
      if(e.code==='AG404')throw new NotFoundException({code:'DRAFT_NOT_FOUND'});
      if(e.code==='AG422')throw new UnprocessableEntityException({code:e.message==='FITTING_PHOTO_UNAVAILABLE'?'FITTING_PHOTO_UNAVAILABLE':'OWNER_PROFILE_UNAVAILABLE'});
      if(e.code==='AG409')throw new ConflictException({code:['SEAL_UNAVAILABLE','IDEMPOTENCY_CONFLICT'].includes(e.message??'')?e.message:'DRAFT_CHANGED'});
      if(['AG400','23514','22P02','22003'].includes(e.code??''))throw new BadRequestException({code:'INVALID_SEAL_FITTING'});
      if(['42883','42P01'].includes(e.code??''))throw new ServiceUnavailableException({code:'SEAL_SETUP_REQUIRED'});
      throw error;
    } finally {client.release();}
  }
}
