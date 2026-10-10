import {BadRequestException,ConflictException,ForbiddenException,HttpException,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {Pool} from 'pg';
import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {setRequestIdentity} from './requestIdentity';
import {SealSigner} from './productionSeals';
import {digest,evidenceInput} from './evidence';

export function fields(value:unknown,allowed:string[],required=allowed):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k))
    ||required.some(k=>!(k in value)))throw new BadRequestException({code:'INVALID_WORKFLOW_INPUT'});
  return value as Record<string,unknown>;
}
export function workflowText(value:unknown,max:number,min=1):string{
  if(typeof value!=='string'||value.trim().length<min||value.trim().length>max||/[\x00-\x1f\x7f]/.test(value))
    throw new BadRequestException({code:'INVALID_WORKFLOW_INPUT'});
  return value.trim();
}
export type CheckLookup={method:'plate'|'chassis'|'seal'|'qr';value:string};
export function checkLookup(value:unknown):CheckLookup{
  const v=fields(value,['method','value']);
  if(!['plate','chassis','seal','qr'].includes(v.method as string))throw new BadRequestException({code:'INVALID_CHECK_LOOKUP'});
  const input=workflowText(v.value,v.method==='qr'?512:160);
  if(v.method==='seal'&&!/^AG[A-F0-9]{32}$/.test(input))throw new BadRequestException({code:'INVALID_CHECK_LOOKUP'});
  return {method:v.method as CheckLookup['method'],value:input};
}
export type CheckResult={id:string;outcome:'pending'|'approved'|'refused'|'timed_out';responseDeadlineAt:string;
  resultExpiresAt:string|null;respondedAt:string|null;expired:boolean;authorizationUsable:boolean;sampleOnly:true;
  vehicle:null|{id:string;plate:string|null;chassisIdentifier:string;saleStatus:string;recordStatus:string}};
export class PostgresWorkflowStore{
  constructor(private readonly pool:Pool,readonly tenant:string){}
  async call<T=unknown>(actor:string,name:string,args:unknown[]):Promise<T>{
    // Only module-owned fixed names can reach SQL; never accept a user function name.
    if(!['lookup_vehicle_check','read_vehicle_check','list_vehicle_checks','decide_vehicle_check','sweep_vehicle_checks',
      'change_vehicle_sale','submit_vehicle_report','read_vehicle_reports','review_vehicle_report','save_report_evidence',
      'read_report_evidence','read_vehicle_status_history'].includes(name))throw new Error('Unknown workflow operation');
    const client=await this.pool.connect();
    try{
      await client.query('begin');await setRequestIdentity(client,this.tenant,actor);
      const result=await client.query(`select private.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args);
      await client.query('commit');return result.rows[0].result as T;
    }catch(error){
      await client.query('rollback');const e=error as {code?:string;message?:string};
      if(e instanceof HttpException)throw e;
      if(e.code==='AG429')throw new HttpException({code:'CHECK_RATE_LIMIT'},429);
      if(['42501','AG403'].includes(e.code??''))throw new ForbiddenException({code:'VERIFIED_ACCESS_REQUIRED'});
      if(e.code==='P0002')throw new NotFoundException({code:'WORKFLOW_NOT_FOUND'});
      if(['AG400','22P02','22007'].includes(e.code??''))throw new BadRequestException({code:'INVALID_WORKFLOW_INPUT'});
      if(['AG409','23505','23514','40001','40P01'].includes(e.code??'')){
        const codes=['CHECKS_NOT_CONFIGURED','OWNER_STEP_UP_SETUP_REQUIRED','CHECK_RESPONSE_LATE','CHECK_ALREADY_ANSWERED',
          'CHECK_APPROVAL_UNAVAILABLE','CHECK_KEY_CONFLICT','CHECK_AMBIGUOUS_IDENTIFIER','STATUS_TRANSITION_DENIED','STATUS_CHANGED','EVIDENCE_LIMIT'];
        throw new ConflictException({code:codes.find(c=>e.message?.includes(c))??'WORKFLOW_CHANGED'});
      }
      if(['42883','42P01','42703'].includes(e.code??''))throw new ServiceUnavailableException({code:'WORKFLOW_SETUP_REQUIRED'});
      throw error;
    }finally{client.release();}
  }
}
export class CheckService{
  constructor(readonly store:PostgresWorkflowStore,private readonly signer?:SealSigner){}
  create(actor:string,key:string,input:CheckLookup):Promise<CheckResult>{
    let {method,value}=input;let version:string|null=null;
    if(method==='qr'){
      if(!this.signer)throw new ServiceUnavailableException({code:'SEAL_SIGNING_SETUP_REQUIRED'});
      const verified=this.signer.verify(value);method='seal';value=verified.code;version=verified.keyVersion;
    }
    return this.store.call(actor,'lookup_vehicle_check',[method,value,version,key]);
  }
  read(actor:string,id:string):Promise<CheckResult>{return this.store.call(actor,'read_vehicle_check',[id]);}
  list(actor:string,owner:boolean,cursor:string|null,limit:number){return this.store.call(actor,'list_vehicle_checks',[owner,cursor,limit]);}
  async decide(actor:string,id:string,decision:'approved'|'refused'){
    await this.store.call(actor,'decide_vehicle_check',[id,decision]);return {id,outcome:decision,sampleOnly:true};
  }
  sweep(limit=100){return this.store.call('','sweep_vehicle_checks',[limit]);}
}
export function configuredChecks(env:NodeJS.ProcessEnv,store:PostgresWorkflowStore){
  const {AUTOGUARDIAN_SEAL_KEYS_JSON:keys,AUTOGUARDIAN_SEAL_ORIGIN:origin,AUTOGUARDIAN_SEAL_ACTIVE_KEY:version}=env;
  if(!keys&&!origin&&!version)return new CheckService(store);
  if(!keys||!origin||!version)throw new Error('Configure all seal signing settings');
  const parsed:unknown=JSON.parse(keys);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Invalid seal key ring');
  return new CheckService(store,new SealSigner(store.tenant,origin,version,parsed as Record<string,string>));
}

// Report encryption uses a dedicated key and binds every file to its authority/report/id.
export class ReportEvidenceService{
  constructor(private readonly store:PostgresWorkflowStore,private readonly key?:Buffer){
    if(key&&key.length!==32)throw new Error('Report evidence key must be 32 bytes');
  }
  private aad(id:string,report:string){return Buffer.from(JSON.stringify(['AutoGuardian/report/v1',this.store.tenant,report,id]));}
  async upload(actor:string,report:string,key:string,value:unknown){
    if(!this.key)throw new ServiceUnavailableException({code:'REPORT_EVIDENCE_SETUP_REQUIRED'});
    const body=fields(value,['kind','dataBase64']);
    if(!['VEHICLE_PHOTO','REGISTRATION_DOCUMENT'].includes(body.kind as string))throw new BadRequestException({code:'INVALID_REPORT_EVIDENCE'});
    const input=await evidenceInput(body),id=randomUUID(),nonce=randomBytes(12);
    const cipher=createCipheriv('aes-256-gcm',this.key,nonce);cipher.setAAD(this.aad(id,report));
    const encrypted=Buffer.concat([cipher.update(input.bytes),cipher.final()]);
    const ciphertext=Buffer.concat([nonce,cipher.getAuthTag(),encrypted]).toString('base64');
    return this.store.call(actor,'save_report_evidence',[report,key,id,input.mime,input.bytes.length,input.sha,ciphertext]);
  }
  async read(actor:string,id:string,review:boolean){
    if(!this.key)throw new ServiceUnavailableException({code:'REPORT_EVIDENCE_SETUP_REQUIRED'});
    const row=await this.store.call<{id:string;report_id:string;ciphertext:string;sha256:string;byte_size:number;mime_type:string}>(actor,'read_report_evidence',[id,randomUUID(),review]);
    try{
      const bytes=Buffer.from(row.ciphertext,'base64');
      const cipher=createDecipheriv('aes-256-gcm',this.key,bytes.subarray(0,12));
      cipher.setAAD(this.aad(row.id,row.report_id));cipher.setAuthTag(bytes.subarray(12,28));
      const plain=Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]);
      if(plain.length!==row.byte_size||digest(plain)!==row.sha256)throw new Error();
      return {id:row.id,mimeType:row.mime_type,dataBase64:plain.toString('base64')};
    }catch{throw new ServiceUnavailableException({code:'REPORT_EVIDENCE_UNAVAILABLE'});}
  }
}
