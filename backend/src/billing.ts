import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException, ServiceUnavailableException,
  Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { IdentityVerifier } from './auth';
import { setRequestIdentity } from './requestIdentity';
import { draftId } from './enrollments';
import { fields } from './checks';
import { PawaPaySandboxClient, confirmSandboxDeposit, SandboxDeposit, pawaPaySandboxConfiguration } from './pawaPayClient';

export type Payment = {id:string;purpose:'REGISTRATION'|'CHECK'|'SUBSCRIPTION';targetId:string;targetRevision:number;amount:string;currency:'CDF'|'USD';
  status:'CREATED'|'PROCESSING'|'COMPLETED'|'FAILED'|'DISCREPANCY';createdAt:string;confirmedAt:string|null;providerReference:string|null;receiptNumber:string|null;sampleOnly:boolean;
  receiptIdentity?:{businessName:string;address:string;registrationNumber:string}|null};
type Job = {id:string;amount:string;currency:'CDF'|'USD';ciphertext:string;leaseId:string;status:string;initiationAllowed?:boolean};
export class BillingStore {
  constructor(private readonly pool:Pool,readonly tenant:string){}
  async call<T=unknown>(actor:string,name:string,args:unknown[],worker=false):Promise<T>{
    const publicNames=['billing_settings','billing_begin','billing_read','billing_quote','billing_subscription_state','billing_reconcile'];
    const workerNames=['billing_claim','billing_finish','billing_sweep'];
    const names=worker?[...workerNames,...workerNames.map(n=>n.replace('billing_','billing_live_')),'billing_sms_claim','billing_sms_finish']
      :[...publicNames,...publicNames.filter(n=>!['billing_settings','billing_quote'].includes(n)).map(n=>n.replace('billing_','billing_live_')),
        'billing_policy','billing_settlement','billing_live_entitlement','billing_offline_lease','billing_live_settings'];
    if(!names.includes(name))throw new Error('Unknown billing operation');
    const client=await this.pool.connect();
    try{
      await client.query('begin');
      if(worker)await client.query('set local role autoguardian_billing_worker');
      await setRequestIdentity(client,this.tenant,actor);
      const result=await client.query(`select private.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args);
      await client.query('commit');return result.rows[0].result;
    }catch(error){
      await client.query('rollback');if(error instanceof HttpException)throw error;
      const e=error as {code?:string;message?:string};
      if(['42501','AG403'].includes(e.code??''))throw new ForbiddenException({code:'BILLING_ACCESS_DENIED'},{cause:error});
      if(e.code==='AG404')throw new NotFoundException({code:'PAYMENT_NOT_FOUND'},{cause:error});
      if(['AG400','22P02','23514','23502'].includes(e.code??''))throw new BadRequestException({code:'INVALID_BILLING_INPUT'});
      if(['AG409','23505','40001','40P01'].includes(e.code??''))throw new ConflictException({code:e.message?.includes('CHECK_PAYMENT_REQUIRED')?'CHECK_PAYMENT_REQUIRED':'BILLING_CHANGED'});
      if(['42883','42P01','42703'].includes(e.code??''))throw new ServiceUnavailableException({code:'BILLING_SETUP_REQUIRED'});
      throw error;
    }finally{client.release();}
  }
}

export function billingInput(value:unknown){
  const v=fields(value,['purpose','targetId','targetRevision','phoneNumber','provider']);
  if(!['REGISTRATION','CHECK','SUBSCRIPTION'].includes(String(v.purpose))||!Number.isInteger(v.targetRevision)||Number(v.targetRevision)<0
    ||Number(v.targetRevision)>2147483647||typeof v.phoneNumber!=='string'||!/^243[0-9]{9}$/.test(v.phoneNumber)
    ||!['AIRTEL_COD','ORANGE_COD','VODACOM_MPESA_COD'].includes(String(v.provider)))throw new BadRequestException({code:'INVALID_BILLING_INPUT'});
  return {purpose:v.purpose as Payment['purpose'],targetId:draftId(v.targetId),targetRevision:Number(v.targetRevision),phoneNumber:v.phoneNumber,provider:String(v.provider)};
}
export function billingSettings(value:unknown){
  const v=fields(value,['sandboxEnabled','currency','registrationFee','checkFee','renewalFee','freeMonthly','periodDays','graceDays','reminderDays','policyAcknowledged']);
  if(typeof v.sandboxEnabled!=='boolean'||v.policyAcknowledged!==false||!['CDF','USD'].includes(String(v.currency)))throw new BadRequestException({code:'INVALID_BILLING_INPUT'});
  for(const key of ['registrationFee','checkFee','renewalFee'])if(typeof v[key]!=='string'||!/^[1-9][0-9]{0,14}(?:\.[0-9]{1,4})?$|^0\.[0-9]{1,4}$/.test(v[key] as string)||Number(v[key])<=0)throw new BadRequestException({code:'INVALID_BILLING_INPUT'});
  for(const [key,min,max] of [['freeMonthly',0,100],['periodDays',1,366],['graceDays',0,90],['reminderDays',0,90]] as const)
    if(!Number.isInteger(v[key])||Number(v[key])<min||Number(v[key])>max)throw new BadRequestException({code:'INVALID_BILLING_INPUT'});
  return v;
}

export class BillingService {
  constructor(readonly store:BillingStore,private readonly key:Buffer,private readonly provider:PawaPaySandboxClient,readonly production=false){
    if(key.length!==32)throw new Error('Billing payer encryption requires 32 bytes.');
  }
  private context(){return Buffer.from(JSON.stringify([this.production?'AutoGuardian/production-payer/v1':'AutoGuardian/sandbox-payer/v1',this.store.tenant]));}
  private operation(name:string){return this.production?name.replace('billing_','billing_live_'):name;}
  async begin(actor:string,key:string,body:unknown){
    const input=billingInput(body),plain=JSON.stringify(input),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,nonce);
    cipher.setAAD(this.context());const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
    const ciphertext=Buffer.concat([nonce,cipher.getAuthTag(),encrypted]).toString('base64');
    const fingerprint=createHmac('sha256',this.key).update(this.context()).update(plain).digest('hex');
    return this.store.call<Payment>(actor,this.operation('billing_begin'),[draftId(key),input.purpose,input.targetId,input.targetRevision,ciphertext,fingerprint]);
  }
  read(actor:string,id:string|null=null,admin=false){return this.store.call(actor,this.operation('billing_read'),[id,admin]);}
  settings(actor:string,body:unknown=null,revision=0){return this.store.call(actor,'billing_settings',[body===null?null:billingSettings(body),revision]);}
  quote(actor:string,key:string){return this.store.call(actor,'billing_quote',[draftId(key)]);}
  subscriptions(actor:string){return this.store.call(actor,this.operation('billing_subscription_state'),[]);}
  reconcile(actor:string,id:string){return this.store.call(actor,this.operation('billing_reconcile'),[draftId(id)]);}
  async processOne(id:string|null=null){
    const job=await this.store.call<Job|null>('',this.operation('billing_claim'),[id],true);if(!job)return false;
    let outcome='PROCESSING',reference:string|null=null;
    try{
      const bytes=Buffer.from(job.ciphertext,'base64'),decipher=createDecipheriv('aes-256-gcm',this.key,bytes.subarray(0,12));
      decipher.setAAD(this.context());decipher.setAuthTag(bytes.subarray(12,28));
      const input=billingInput(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8')));
      const deposit:SandboxDeposit={depositId:job.id,amount:job.amount,currency:job.currency,payer:{type:'MMO',accountDetails:{phoneNumber:input.phoneNumber,provider:input.provider}}};
      let status=await this.provider.depositStatus(job.id);
      if(!status&&(!this.production||job.initiationAllowed===true)){
        const initiation=await this.provider.initiateDeposit(deposit);
        if(initiation.status==='REJECTED')outcome='FAILED';
        else status=await this.provider.depositStatus(job.id);
      }
      if(status){
        try{confirmSandboxDeposit(deposit,status);}catch{outcome='DISCREPANCY';}
        if(outcome!=='DISCREPANCY')outcome=['COMPLETED','FAILED'].includes(String(status.status))?String(status.status):'PROCESSING';
        reference=typeof status.providerTransactionId==='string'?status.providerTransactionId:null;
      }
    }catch(error){
      // Unknown outcomes stay pending; the lease/retry journal survives worker restart.
      // Never expose provider messages or payer details to public responses/logs.
      if(error instanceof BadRequestException)outcome='DISCREPANCY';
    }
    await this.store.call('',this.operation('billing_finish'),[job.id,job.leaseId,outcome,job.amount,job.currency,reference],true);
    return true;
  }
  async sweep(){return this.store.call<number>('',this.operation('billing_sweep'),[],true);}
}
export function configuredBilling(env:NodeJS.ProcessEnv,pool:Pool,tenant:string){
  if(env.PILOT_BILLING_SANDBOX_ENABLED!=='true')return undefined;
  const config=pawaPaySandboxConfiguration(env);
  if(!/^[a-f0-9]{64}$/i.test(env.PILOT_BILLING_KEY_HEX??''))throw new Error('Configure PILOT_BILLING_KEY_HEX before enabling sandbox billing.');
  return new BillingService(new BillingStore(pool,tenant),Buffer.from(env.PILOT_BILLING_KEY_HEX!,'hex'),new PawaPaySandboxClient(config));
}

@Controller('billing')
export class BillingController {
  constructor(@Inject('BILLING') private readonly service:BillingService,@Inject('BILLING_AUTH') private readonly auth:IdentityVerifier,
    @Inject('BILLING_STAFF_AUTH') private readonly staff:IdentityVerifier){}
  @Get('payments') async list(@Headers('authorization') h:string|undefined){return this.service.read(await this.auth.verify(h));}
  @Get('payments/:id') async read(@Headers('authorization') h:string|undefined,@Param('id') id:string){return this.service.read(await this.auth.verify(h),draftId(id));}
  @Post('payments') @HttpCode(200) async create(@Headers('authorization') h:string|undefined,@Headers('idempotency-key') key:string,@Body() body:unknown){
    const input=billingInput(body);const actor=await (input.purpose==='REGISTRATION'?this.staff:this.auth).verify(h);
    return this.service.begin(actor,key,input);
  }
  @Get('check-quote') async quote(@Headers('authorization') h:string|undefined,@Query('key') key:string){return this.service.quote(await this.auth.verify(h),key);}
  @Get('subscriptions') async subscriptions(@Headers('authorization') h:string|undefined){return this.service.subscriptions(await this.auth.verify(h));}
  @Get('settings') async settings(@Headers('authorization') h:string|undefined){return this.service.settings(await this.auth.verify(h));}
  @Get('reconciliation') async reconciliation(@Headers('authorization') h:string|undefined){return this.service.read(await this.staff.verify(h),null,true);}
  @Post('payments/:id/reconcile') @HttpCode(200) async retry(@Headers('authorization') h:string|undefined,@Param('id') id:string,@Body() body:unknown){
    const actor=await this.staff.verify(h);fields(body,[]);return this.service.reconcile(actor,id);
  }
  @Put('settings') async configure(@Headers('authorization') h:string|undefined,@Body() body:unknown){
    const input=fields(body,['expectedRevision','settings']);
    if(!Number.isInteger(input.expectedRevision)||Number(input.expectedRevision)<0)throw new BadRequestException({code:'INVALID_BILLING_INPUT'});
    return this.service.settings(await this.staff.verify(h),input.settings,Number(input.expectedRevision));
  }
}
