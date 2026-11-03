import {Body,Controller,Get,Headers,HttpCode,Inject,Param,Post,Put,Query,BadRequestException} from '@nestjs/common';
import {Pool} from 'pg';
import {BillingService,BillingStore,billingInput} from './billing';
import {billingPolicy,settlementInput} from './billingPolicy';
import {IdentityVerifier} from './auth';
import {draftId} from './enrollments';
import {fields} from './checks';
import {PawaPayProductionClient,pawaPayProductionConfiguration} from './pawaPayClient';

export function configuredLiveBilling(env:NodeJS.ProcessEnv,pool:Pool,tenant:string){
 const config=pawaPayProductionConfiguration(env);if(!config)return undefined;
 if(!/^[a-f0-9]{64}$/i.test(env.PAWAPAY_LIVE_BILLING_KEY_HEX??'')||env.PAWAPAY_LIVE_BILLING_KEY_HEX===env.PILOT_BILLING_KEY_HEX)
  throw new Error('Configure a separate live payer encryption key.');
 return new BillingService(new BillingStore(pool,tenant),Buffer.from(env.PAWAPAY_LIVE_BILLING_KEY_HEX!,'hex'),new PawaPayProductionClient(config),true);
}

@Controller('billing/operations')
export class BillingOperationsController {
 constructor(@Inject('BILLING_OPERATIONS_STORE')private readonly store:BillingStore,
  @Inject('BILLING_OPERATIONS_AUTH')private readonly auth:IdentityVerifier,
  @Inject('BILLING_OPERATIONS_STAFF')private readonly staff:IdentityVerifier){}
 @Get('policy')async policy(@Headers('authorization')h:string|undefined){return this.store.call(await this.staff.verify(h),'billing_policy',[null,0]);}
 @Put('policy')async configure(@Headers('authorization')h:string|undefined,@Body()body:unknown){
  const input=fields(body,['expectedRevision','policy']);
  if(!Number.isInteger(input.expectedRevision)||Number(input.expectedRevision)<0)throw new BadRequestException();
  return this.store.call(await this.staff.verify(h),'billing_policy',[billingPolicy(input.policy),input.expectedRevision]);
 }
 @Get('settlements')async settlements(@Headers('authorization')h:string|undefined){return this.store.call(await this.staff.verify(h),'billing_settlement',[null]);}
 @Post('settlements')@HttpCode(200)async import(@Headers('authorization')h:string|undefined,@Body()body:unknown){return this.store.call(await this.staff.verify(h),'billing_settlement',[settlementInput(body)]);}
 @Get('entitlements/:vehicleId')async entitlement(@Headers('authorization')h:string|undefined,@Param('vehicleId')id:string,@Query('feature')feature:string){
  return this.store.call(await this.auth.verify(h),'billing_live_entitlement',[draftId(id),feature]);
 }
 @Post('offline-lease')@HttpCode(200)async lease(@Headers('authorization')h:string|undefined,@Body()body:unknown){
  fields(body,[]);return this.store.call(await this.staff.verify(h),'billing_offline_lease',[]);
 }
}

@Controller('billing/live')
export class LiveBillingController {
 constructor(@Inject('LIVE_BILLING')private readonly service:BillingService,@Inject('BILLING_OPERATIONS_AUTH')private readonly auth:IdentityVerifier,
  @Inject('BILLING_OPERATIONS_STAFF')private readonly staff:IdentityVerifier){}
 @Get('settings')async settings(@Headers('authorization')h:string|undefined){return this.service.store.call(await this.auth.verify(h),'billing_live_settings',[]);}
 @Get('payments')async list(@Headers('authorization')h:string|undefined){return this.service.read(await this.auth.verify(h));}
 @Get('payments/:id')async read(@Headers('authorization')h:string|undefined,@Param('id')id:string){return this.service.read(await this.auth.verify(h),draftId(id));}
 @Post('payments')@HttpCode(200)async create(@Headers('authorization')h:string|undefined,@Headers('idempotency-key')key:string,@Body()body:unknown){
  const input=billingInput(body);if(input.purpose==='CHECK')throw new BadRequestException({code:'LIVE_CHECKS_NOT_ENABLED'});
  return this.service.begin(await(input.purpose==='REGISTRATION'?this.staff:this.auth).verify(h),key,input);
 }
 @Get('subscriptions')async subscriptions(@Headers('authorization')h:string|undefined){return this.service.subscriptions(await this.auth.verify(h));}
 @Get('reconciliation')async reconciliation(@Headers('authorization')h:string|undefined){return this.service.read(await this.staff.verify(h),null,true);}
 @Post('payments/:id/reconcile')@HttpCode(200)async reconcile(@Headers('authorization')h:string|undefined,@Param('id')id:string,@Body()body:unknown){
  fields(body,[]);return this.service.reconcile(await this.staff.verify(h),id);
 }
}
