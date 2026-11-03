import {BadRequestException,Body,Controller,Get,Header,Headers,HttpCode,Inject,Param,Post,Put,Query,Req} from '@nestjs/common';
import {AfricasTalkingChannels} from './telecomChannels';
import {SupabaseSmsHook} from './smsHook';
import {OwnerPinService,pinPolicy} from './ownerPin';
import {IdentityVerifier} from './auth';
import {RelationshipService} from './relationships';
import {draftId} from './enrollments';

export type TelecomServices={channels?:AfricasTalkingChannels;hook?:SupabaseSmsHook;pin?:OwnerPinService;relationships?:RelationshipService};
@Controller('me/vehicle-relationships')
export class RelationshipController {
 constructor(@Inject('TELECOM') private readonly service:TelecomServices,@Inject('WORKFLOW_AUTH') private readonly auth:IdentityVerifier){}
 private query(q:Record<string,unknown>){if(Object.keys(q).length)throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});}
 @Get() async list(@Headers('authorization') h:string|undefined,@Query() q:Record<string,unknown>){this.query(q);return this.service.relationships!.list(await this.auth.verify(h));}
 @Post() @HttpCode(200) async invite(@Headers('authorization') h:string|undefined,@Headers('idempotency-key') key:string|undefined,@Body() body:unknown,@Query() q:Record<string,unknown>){this.query(q);return this.service.relationships!.invite(await this.auth.verify(h),draftId(key),body);}
 @Post(':id/acceptance') @HttpCode(200) async start(@Headers('authorization') h:string|undefined,@Param('id') id:string,@Body() body:unknown,@Query() q:Record<string,unknown>){this.query(q);return this.service.relationships!.start(await this.auth.verify(h),draftId(id),body);}
 @Post('confirm') @HttpCode(200) async confirm(@Headers('authorization') h:string|undefined,@Body() body:unknown,@Query() q:Record<string,unknown>){this.query(q);return this.service.relationships!.confirm(await this.auth.verify(h),body);}
 @Post(':id/revoke') @HttpCode(200) async revoke(@Headers('authorization') h:string|undefined,@Param('id') id:string,@Body() body:unknown,@Query() q:Record<string,unknown>){this.query(q);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw new BadRequestException();return this.service.relationships!.revoke(await this.auth.verify(h),draftId(id));}
}
@Controller('me/owner-pin')
export class OwnerPinController {
 constructor(@Inject('TELECOM') private readonly service:TelecomServices,@Inject('WORKFLOW_AUTH') private readonly auth:IdentityVerifier){}
 private query(query:Record<string,unknown>){if(Object.keys(query).length)throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});}
 @Get() async status(@Headers('authorization') h:string|undefined,@Query() query:Record<string,unknown>){this.query(query);return this.service.pin!.status(await this.auth.verify(h));}
 @Post('enrollments') @HttpCode(200)
 async enroll(@Headers('authorization') h:string|undefined,@Body() body:unknown,@Query() query:Record<string,unknown>){this.query(query);return this.service.pin!.enroll(await this.auth.verify(h),body);}
 @Post('confirm') @HttpCode(200)
 async confirm(@Headers('authorization') h:string|undefined,@Body() body:unknown,@Query() query:Record<string,unknown>){this.query(query);return this.service.pin!.confirm(await this.auth.verify(h),body);}
 @Post('proofs') @HttpCode(200)
 async proof(@Headers('authorization') h:string|undefined,@Body() body:unknown,@Query() query:Record<string,unknown>){this.query(query);return this.service.pin!.proof(await this.auth.verify(h),body);}
}
@Controller('administration/owner-pin-policy')
export class OwnerPinPolicyController {
 constructor(@Inject('TELECOM') private readonly service:TelecomServices,@Inject('WORKFLOW_STAFF_AUTH') private readonly auth:IdentityVerifier){}
 private query(query:Record<string,unknown>){if(Object.keys(query).length)throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});}
 @Get() async read(@Headers('authorization') h:string|undefined,@Query() query:Record<string,unknown>){this.query(query);return this.service.pin!.store.call(await this.auth.verify(h),'owner_pin_settings',[null]);}
 @Put() async write(@Headers('authorization') h:string|undefined,@Body() body:unknown,@Query() query:Record<string,unknown>){this.query(query);return this.service.pin!.store.call(await this.auth.verify(h),'owner_pin_settings',[pinPolicy(body)]);}
}
@Controller('webhooks/africastalking')
export class TelecomController {
 constructor(@Inject('TELECOM') private readonly service:TelecomServices){}
 private query(query:Record<string,unknown>){if(Object.keys(query).length)throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});}
 @Post('sms/inbound') @HttpCode(204)
 async inbound(@Headers('x-autoguardian-gateway-token') token:string|undefined,@Headers('content-type') type:string|undefined,@Body() body:unknown,@Query() query:Record<string,unknown>){
  this.query(query);await this.service.channels!.inbound(token,type,body);
 }
 @Post('ussd') @HttpCode(200) @Header('Content-Type','text/plain; charset=utf-8')
 async ussd(@Headers('x-autoguardian-gateway-token') token:string|undefined,@Headers('content-type') type:string|undefined,@Body() body:unknown,@Query() query:Record<string,unknown>){
  this.query(query);return this.service.channels!.ussd(token,type,body);
 }
 @Post('ussd/events') @HttpCode(204)
 async event(@Headers('x-autoguardian-gateway-token') token:string|undefined,@Headers('content-type') type:string|undefined,@Body() body:unknown,@Query() query:Record<string,unknown>){
  this.query(query);await this.service.channels!.event(token,type,body);
 }
}
@Controller('webhooks/supabase')
export class SmsHookController {
 constructor(@Inject('TELECOM') private readonly service:TelecomServices){}
 @Post('send-sms') @HttpCode(200)
 async send(@Req() request:{rawBody?:Buffer;headers:Record<string,string|undefined>},@Query() query:Record<string,unknown>){
  if(Object.keys(query).length)throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});
  return this.service.hook!.receive(request.rawBody,request.headers);
 }
}
