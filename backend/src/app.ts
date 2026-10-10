import 'reflect-metadata';
import { BadRequestException, Body, Catch, Controller, ExceptionFilter, Get, Headers, HttpException,
  HttpCode, Inject, Module, Post, Put, ArgumentsHost, Param, Query, Req } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { EvidenceService } from './evidence';
import { AccountStore } from './account';
import { IdentityVerifier } from './auth';
import { VehicleStore, vehicleId, vehiclePage } from './vehicles';
import { EnrollmentStore, draftId, draftInput } from './enrollments';
import { SealStore, sealFittingInput, sealLocationInput } from './seals';
import {ProductionSealService} from './productionSeals';
import { ReadinessStore } from './readiness';
import { OwnerService } from './owner';
import { SubmissionStore, submissionInput } from './submission';
import { RegistrationReviewService } from './registrationReviews';
import {identityRequest} from './requestIdentity';
import {ConsentStore,consentInput} from './consent';
import {TwilioSmsWebhooks} from './sms';
import {CheckService,ReportEvidenceService} from './checks';
import {CheckController,CheckInboxController,VehicleStatusController,VehicleReportController,VehicleReportReviewController} from './workflowControllers';

@Controller('webhooks/twilio/sms')
class TwilioSmsController {
  constructor(@Inject('SMS_WEBHOOKS') private readonly webhooks:TwilioSmsWebhooks){}
  @Post(':notificationId/:attemptId') @HttpCode(204)
  async delivery(@Param('notificationId') notificationId:string,@Param('attemptId') attemptId:string,
    @Req() request:{originalUrl:string},@Headers('x-twilio-signature') signature:string|undefined,
    @Headers('content-type') contentType:string|undefined,@Body() body:unknown){
    await this.webhooks.receive(notificationId,attemptId,request.originalUrl,signature,contentType,body);
  }
}

@Controller('me/registration-consents')
class ConsentController {
  constructor(@Inject('CONSENT_AUTH') private readonly auth:IdentityVerifier,@Inject('CONSENTS') private readonly store:ConsentStore){}
  private query(q:Record<string,unknown>){if(Object.keys(q).length)throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});}
  @Get() async list(@Headers('authorization') h:string|undefined,@Query() q:Record<string,unknown>){
    const actor=await this.auth.verify(h);this.query(q);return this.store.list(actor);
  }
  @Get(':id') async read(@Headers('authorization') h:string|undefined,@Param('id') id:string,@Query() q:Record<string,unknown>){
    const actor=await this.auth.verify(h);this.query(q);return this.store.read(actor,draftId(id));
  }
  @Post(':id') @HttpCode(200) async change(@Headers('authorization') h:string|undefined,@Param('id') id:string,
    @Headers('idempotency-key') key:string|undefined,@Body() body:unknown,@Query() q:Record<string,unknown>){
    const actor=await this.auth.verify(h);this.query(q);return this.store.change(actor,draftId(id),draftId(key),consentInput(body));
  }
}

@Controller('me/staff-access')
class StaffAccessController {
  constructor(@Inject('STAFF_PROOF_AUTH') private readonly auth:IdentityVerifier,@Inject('CONSENTS') private readonly store:ConsentStore){}
  @Get() async read(@Headers('authorization') h:string|undefined,@Query() q:Record<string,unknown>){
    const actor=await this.auth.verify(h);if(Object.keys(q).length)throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});
    return this.store.staffStatus(actor);
  }
}

@Controller('registration-reviews')
class RegistrationReviewController {
  constructor(@Inject('STAFF_AUTH') private readonly auth: IdentityVerifier,
    @Inject('REGISTRATION_REVIEWS') private readonly reviews: RegistrationReviewService) {}
  @Get() async queue(@Headers('authorization') header: string | undefined, @Query() query: Record<string,unknown>) {
    const actor=await this.auth.verify(header);
    const limit=query.limit===undefined?20:Number(query.limit),offset=query.offset===undefined?0:Number(query.offset);
    if(Object.keys(query).some(k=>!['limit','offset'].includes(k)) || !Number.isInteger(limit) || limit<1 || limit>50
      || !Number.isInteger(offset) || offset<0 || offset>2147483647 || ['limit','offset'].some(k=>query[k]!==undefined
        && (typeof query[k]!=='string' || !/^\d+$/.test(query[k] as string)))) throw new BadRequestException({code:'INVALID_PAGE'});
    return this.reviews.queue(actor,limit,offset);
  }
  @Get(':id') async read(@Headers('authorization') header: string | undefined,@Param('id') id: string,@Query() query: Record<string,unknown>) {
    const actor=await this.auth.verify(header);
    if(Object.keys(query).length)throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});
    return this.reviews.read(actor,draftId(id));
  }
  @Get(':id/feedback') async feedback(@Headers('authorization') header: string | undefined,@Param('id') id: string,@Query() query: Record<string,unknown>) {
    const actor=await this.auth.verify(header);
    if(Object.keys(query).length)throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});
    return this.reviews.feedback(actor,draftId(id));
  }
  @Post(':id') @HttpCode(200) async change(@Headers('authorization') header: string | undefined,@Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,@Body() body: unknown,@Query() query: Record<string,unknown>) {
    const actor=await this.auth.verify(header);
    if(Object.keys(query).length)throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});
    return this.reviews.change(actor,draftId(id),draftId(key),body);
  }
}

@Controller('enrollment-drafts/:id/submission')
class SubmissionController {
  constructor(@Inject('DRAFT_AUTH') private readonly auth: IdentityVerifier,
    @Inject('SUBMISSION') private readonly store: SubmissionStore) {}
  @Get() async read(@Headers('authorization') header: string | undefined, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    const actor = await this.auth.verify(header);
    if (Object.keys(query).length) throw new BadRequestException({ code: 'UNEXPECTED_QUERY_FIELDS' });
    return this.store.read(actor, draftId(id));
  }
  private async change(header: string | undefined, id: string, key: string | undefined, body: unknown, query: Record<string, unknown>, action: 'submit' | 'finalize') {
    const actor = await this.auth.verify(header);
    if (Object.keys(query).length) throw new BadRequestException({ code: 'UNEXPECTED_QUERY_FIELDS' });
    const input = submissionInput(body);
    return this.store.execute(actor, draftId(id), draftId(key), input.expectedDraftRevision, action, input.expectedSnapshotRevision);
  }
  @Post() @HttpCode(200) submit(@Headers('authorization') header: string | undefined, @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Query() query: Record<string, unknown>) {
    return this.change(header, id, key, body, query, 'submit');
  }
  @Post('finalize') @HttpCode(200) finalize(@Headers('authorization') header: string | undefined, @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Query() query: Record<string, unknown>) {
    return this.change(header, id, key, body, query, 'finalize');
  }
}

@Controller('enrollment-drafts/:id/owner')
class OwnerController {
  constructor(@Inject('DRAFT_AUTH') private readonly auth: IdentityVerifier,
    @Inject('OWNER') private readonly owner: OwnerService) {}
  private query(query: Record<string, unknown>) {
    if (Object.keys(query).length) throw new BadRequestException({ code: 'UNEXPECTED_QUERY_FIELDS' });
  }
  @Get() async read(@Headers('authorization') header: string | undefined, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    const actor = await this.auth.verify(header); this.query(query);
    return this.owner.read(actor, draftId(id));
  }
  @Post() @HttpCode(200) async save(@Headers('authorization') header: string | undefined, @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Query() query: Record<string, unknown>) {
    const actor = await this.auth.verify(header); this.query(query);
    return this.owner.save(actor, draftId(id), draftId(key), body);
  }
  @Post('consent') @HttpCode(200) async consent(@Headers('authorization') header: string | undefined, @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Query() query: Record<string, unknown>) {
    const actor = await this.auth.verify(header); this.query(query);
    return this.owner.consent(actor, draftId(id), draftId(key), body);
  }
}

@Controller('enrollment-drafts/:id/readiness')
class ReadinessController {
  constructor(@Inject('DRAFT_AUTH') private readonly auth: IdentityVerifier,
    @Inject('READINESS') private readonly readiness: ReadinessStore) {}
  @Get() async read(@Headers('authorization') header: string | undefined, @Param('id') id: string,
    @Query() query: Record<string, unknown>) {
    const actor = await this.auth.verify(header);
    if (Object.keys(query).length) throw new BadRequestException({ code: 'UNEXPECTED_QUERY_FIELDS' });
    return this.readiness.read(actor, draftId(id));
  }
}

@Controller('seal-stock')
class SealStockController {
  constructor(@Inject('DRAFT_AUTH') private readonly auth:IdentityVerifier,@Inject('SEALS') private readonly seals:SealStore) {}
  @Get() async stock(@Headers('authorization') header:string|undefined,@Query() query:Record<string,unknown>) {
    const actor=await this.auth.verify(header);const {organizationId,...page}=query;
    return this.seals.stock(actor,draftId(organizationId),vehiclePage(page));
  }
}
@Controller('enrollment-drafts/:id/seals')
class SealFittingController {
  constructor(@Inject('DRAFT_AUTH') private readonly auth:IdentityVerifier,@Inject('SEALS') private readonly seals:SealStore) {}
  @Get('locations') async locations(@Headers('authorization') header:string|undefined,@Param('id') id:string,@Query() query:Record<string,unknown>) {
    const actor=await this.auth.verify(header);if(Object.keys(query).length)throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});
    return this.seals.locations(actor,draftId(id));
  }
  @Post('locations') @HttpCode(200) async saveLocations(@Headers('authorization') header:string|undefined,@Param('id') id:string,
    @Headers('idempotency-key') key:string|undefined,@Body() body:unknown,@Query() query:Record<string,unknown>) {
    const actor=await this.auth.verify(header);if(Object.keys(query).length)throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});
    return this.seals.saveLocations(actor,draftId(id),draftId(key),sealLocationInput(body));
  }
  @Post('validate') @HttpCode(200) async validate(@Headers('authorization') header:string|undefined,@Param('id') id:string,
    @Body() body:unknown,@Query() query:Record<string,unknown>) {
    const actor=await this.auth.verify(header);if(Object.keys(query).length)throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});
    return this.seals.validate(actor,draftId(id),sealFittingInput(body,true));
  }
  @Get() async read(@Headers('authorization') header:string|undefined,@Param('id') id:string,@Query() query:Record<string,unknown>) {
    const actor=await this.auth.verify(header);if(Object.keys(query).length)throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});
    return this.seals.fitting(actor,draftId(id));
  }
  @Post() @HttpCode(200) async save(@Headers('authorization') header:string|undefined,@Param('id') id:string,
    @Headers('idempotency-key') key:string|undefined,@Body() body:unknown,@Query() query:Record<string,unknown>) {
    const actor=await this.auth.verify(header);if(Object.keys(query).length)throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});
    return this.seals.save(actor,draftId(id),draftId(key),sealFittingInput(body));
  }
}

@Controller('enrollment-drafts/:id/attachments')
class EvidenceController {
  constructor(@Inject('DRAFT_AUTH') private readonly auth:IdentityVerifier,@Inject('EVIDENCE') private readonly evidence:EvidenceService) {}
  @Get('reviews') async reviews(@Headers('authorization') header:string|undefined,@Param('id') id:string,@Query() query:Record<string,unknown>) {
    const actor=await this.auth.verify(header);if(Object.keys(query).length) throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});
    return this.evidence.reviews(actor,draftId(id));
  }
  @Post(':attachmentId/review') @HttpCode(200) async review(@Headers('authorization') header:string|undefined,@Param('id') id:string,
    @Param('attachmentId') attachmentId:string,@Headers('idempotency-key') key:string|undefined,@Body() body:unknown,@Query() query:Record<string,unknown>) {
    const actor=await this.auth.verify(header);if(Object.keys(query).length) throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});
    return this.evidence.saveReview(actor,draftId(id),draftId(attachmentId),draftId(key),body);
  }
  @Get() async list(@Headers('authorization') header:string|undefined,@Param('id') id:string,@Query() query:Record<string,unknown>) {
    const actor=await this.auth.verify(header);if(Object.keys(query).length) throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});
    return this.evidence.list(actor,draftId(id));
  }
  @Post() @HttpCode(200) async upload(@Headers('authorization') header:string|undefined,@Param('id') id:string,
    @Headers('idempotency-key') key:string|undefined,@Body() body:unknown,@Query() query:Record<string,unknown>) {
    const actor=await this.auth.verify(header);if(Object.keys(query).length) throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});
    return this.evidence.upload(actor,draftId(id),draftId(key),body);
  }
  @Post(':attachmentId/read') @HttpCode(200) async read(@Headers('authorization') header:string|undefined,@Param('id') id:string,
    @Param('attachmentId') attachmentId:string,@Body() body:unknown,@Query() query:Record<string,unknown>) {
    const actor=await this.auth.verify(header);if(Object.keys(query).length) throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});
    return this.evidence.read(actor,draftId(id),draftId(attachmentId),body);
  }
}

@Controller('enrollment-drafts')
class EnrollmentController {
  constructor(@Inject('DRAFT_AUTH') private readonly auth: IdentityVerifier,
    @Inject('ENROLLMENTS') private readonly enrollments: EnrollmentStore) {}
  @Get() async list(@Headers('authorization') header: string | undefined, @Query() query: Record<string, unknown>) {
    return this.enrollments.list(await this.auth.verify(header),vehiclePage(query));
  }
  @Get('owner-options') async ownerOptions(@Headers('authorization') header: string | undefined, @Query() query: Record<string, unknown>) {
    const actor = await this.auth.verify(header);
    if (Object.keys(query).some(key => key !== 'organizationId')) throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});
    return this.enrollments.ownerOptions(actor,draftId(query.organizationId));
  }
  @Get(':id') async detail(@Headers('authorization') header: string | undefined, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    const actor = await this.auth.verify(header);
    if (Object.keys(query).length) throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});
    return this.enrollments.detail(actor,draftId(id));
  }
  @Post() @HttpCode(200) async create(@Headers('authorization') header: string | undefined,
    @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Query() query: Record<string, unknown>) {
    const actor = await this.auth.verify(header);
    if (Object.keys(query).length) throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});
    return this.enrollments.save(actor,draftInput(body),undefined,draftId(key));
  }
  @Put(':id') async update(@Headers('authorization') header: string | undefined, @Param('id') id: string,
    @Body() body: unknown, @Query() query: Record<string, unknown>) {
    const actor = await this.auth.verify(header);
    if (Object.keys(query).length) throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});
    return this.enrollments.save(actor,draftInput(body,true),draftId(id));
  }
}

@Controller()
class AccountController {
  constructor(@Inject('ACCOUNT_AUTH') private readonly auth: IdentityVerifier,
    @Inject('ACCOUNTS') private readonly accounts: AccountStore) {}
  @Get('health') health() { return { status: 'ok' }; }
  @Get('me') async me(@Headers('authorization') header: string | undefined) {
    return this.accounts.load(await this.auth.verify(header), false);
  }
  @Post('me/profile') @HttpCode(200)
  async provision(@Headers('authorization') header: string | undefined, @Body() body: unknown) {
    const authId = await this.auth.verify(header);
    if (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 0)) {
      throw new BadRequestException({ code: 'UNEXPECTED_FIELDS', message: 'Send an empty JSON object.' });
    }
    return this.accounts.load(authId, true);
  }
}

@Controller('me/vehicles')
class VehicleController {
  constructor(@Inject('AUTH') private readonly auth: IdentityVerifier,
    @Inject('VEHICLES') private readonly vehicles: VehicleStore) {}
  @Get() async list(@Headers('authorization') header: string | undefined, @Query() query: Record<string, unknown>) {
    const actor = await this.auth.verify(header);
    return this.vehicles.list(actor, vehiclePage(query));
  }
  @Get(':id') async detail(@Headers('authorization') header: string | undefined,
    @Param('id') id: string, @Query() query: Record<string, unknown>) {
    const actor = await this.auth.verify(header);
    if (Object.keys(query).length) throw new BadRequestException({ code: 'UNEXPECTED_QUERY_FIELDS' });
    return this.vehicles.detail(actor, vehicleId(id));
  }
}

@Catch()
class ApiErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    response.setHeader('Cache-Control', 'no-store');
    if (error instanceof HttpException) {
      response.status(error.getStatus()).json(error.getResponse());
    } else {
      if((error as {type?:string}).type==='entity.too.large') {response.status(413).json({code:'EVIDENCE_TOO_LARGE'});return;}
      if((error as {type?:string}).type==='entity.parse.failed') {response.status(400).json({code:'INVALID_JSON'});return;}
      // No database details, connection strings, or tokens in client errors.
      response.status(503).json({ code: 'SERVICE_UNAVAILABLE' });
    }
  }
}

@Controller('registration-seals')
class ProductionSealController {
  constructor(@Inject('STAFF_PROOF_AUTH') private readonly auth:IdentityVerifier,@Inject('PRODUCTION_SEALS') private readonly seals:ProductionSealService) {}
  private query(query:Record<string,unknown>) {if(Object.keys(query).length)throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});}
  @Post('batches') @HttpCode(200) async issue(@Headers('authorization') header:string|undefined,@Headers('idempotency-key') key:string|undefined,@Body() body:unknown,@Query() query:Record<string,unknown>) {
    const actor=await this.auth.verify(header);this.query(query);return this.seals.issue(actor,draftId(key),body);
  }
  @Post('verify') @HttpCode(200) async verify(@Headers('authorization') header:string|undefined,@Body() body:unknown,@Query() query:Record<string,unknown>) {
    const actor=await this.auth.verify(header);this.query(query);return this.seals.verify(actor,body);
  }
  @Post('revocations') @HttpCode(200) async revoke(@Headers('authorization') header:string|undefined,@Headers('idempotency-key') key:string|undefined,@Body() body:unknown,@Query() query:Record<string,unknown>) {
    const actor=await this.auth.verify(header);this.query(query);return this.seals.revoke(actor,draftId(key),body);
  }
  @Get(':id/inspection') async read(@Headers('authorization') header:string|undefined,@Param('id') id:string,@Query() query:Record<string,unknown>) {
    const actor=await this.auth.verify(header);this.query(query);return this.seals.read(actor,draftId(id));
  }
  @Post(':id/inspection') @HttpCode(200) async inspect(@Headers('authorization') header:string|undefined,@Param('id') id:string,@Headers('idempotency-key') key:string|undefined,@Body() body:unknown,@Query() query:Record<string,unknown>) {
    const actor=await this.auth.verify(header);this.query(query);return this.seals.inspect(actor,draftId(id),draftId(key),body);
  }
}

export async function createApp(auth: IdentityVerifier, accounts: AccountStore, corsOrigin?: string, vehicles?: VehicleStore,
  enrollments?: { auth: IdentityVerifier; store: EnrollmentStore; evidence?:EvidenceService; seals?:SealStore; productionSeals?:ProductionSealService; readiness?:ReadinessStore; owner?:OwnerService; submission?:SubmissionStore; registrationReviews?:RegistrationReviewService },
  access?:{accountAuth:IdentityVerifier;staffAuth:IdentityVerifier;staffProofAuth?:IdentityVerifier;consentAuth?:IdentityVerifier;consents?:ConsentStore},
  smsWebhooks?:TwilioSmsWebhooks,
  workflows?:{auth:IdentityVerifier;staffAuth:IdentityVerifier;checks:CheckService;evidence:ReportEvidenceService}) {
  @Module({ controllers: [AccountController, ...(vehicles ? [VehicleController] : []), ...(enrollments ? [EnrollmentController] : []),
    ...(enrollments?.evidence?[EvidenceController]:[]),...(enrollments?.seals?[SealStockController,SealFittingController]:[]),
    ...(enrollments?.productionSeals?[ProductionSealController]:[]),
    ...(enrollments?.readiness?[ReadinessController]:[]), ...(enrollments?.owner?[OwnerController]:[]), ...(enrollments?.submission?[SubmissionController]:[]),
    ...(enrollments?.registrationReviews?[RegistrationReviewController]:[]),...(access?.consents?[ConsentController,StaffAccessController]:[]),
    ...(smsWebhooks?[TwilioSmsController]:[]),...(workflows?[CheckController,CheckInboxController,VehicleStatusController,VehicleReportController,VehicleReportReviewController]:[])], providers: [
    { provide: 'AUTH', useValue: auth }, { provide: 'ACCOUNTS', useValue: accounts },
    ...(workflows?[{provide:'WORKFLOW_AUTH',useValue:workflows.auth},{provide:'WORKFLOW_STAFF_AUTH',useValue:workflows.staffAuth},
      {provide:'CHECKS',useValue:workflows.checks},{provide:'REPORT_EVIDENCE',useValue:workflows.evidence}]:[]),
    {provide:'ACCOUNT_AUTH',useValue:access?.accountAuth??auth},{provide:'STAFF_AUTH',useValue:access?.staffAuth??enrollments?.auth??auth},
    {provide:'STAFF_PROOF_AUTH',useValue:access?.staffProofAuth??access?.staffAuth??auth},
    {provide:'CONSENT_AUTH',useValue:access?.consentAuth??access?.accountAuth??auth},
    ...(smsWebhooks?[{provide:'SMS_WEBHOOKS',useValue:smsWebhooks}]:[]),
    ...(access?.consents?[{provide:'CONSENTS',useValue:access.consents}]:[]),
    ...(vehicles ? [{ provide: 'VEHICLES', useValue: vehicles }] : []),
    ...(enrollments ? [{provide:'DRAFT_AUTH',useValue:enrollments.auth},{provide:'ENROLLMENTS',useValue:enrollments.store}] : []),
    ...(enrollments?.evidence?[{provide:'EVIDENCE',useValue:enrollments.evidence}]:[]),
    ...(enrollments?.seals?[{provide:'SEALS',useValue:enrollments.seals}]:[]),
    ...(enrollments?.productionSeals?[{provide:'PRODUCTION_SEALS',useValue:enrollments.productionSeals}]:[]),
    ...(enrollments?.readiness?[{provide:'READINESS',useValue:enrollments.readiness}]:[]),
    ...(enrollments?.owner?[{provide:'OWNER',useValue:enrollments.owner}]:[]),
    ...(enrollments?.submission?[{provide:'SUBMISSION',useValue:enrollments.submission}]:[]),
    ...(enrollments?.registrationReviews?[{provide:'REGISTRATION_REVIEWS',useValue:enrollments.registrationReviews}]:[]),
  ] }) class AppModule {}
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  app.use((_req:unknown,_res:unknown,next:()=>void)=>identityRequest(next));
  app.useBodyParser('json',{limit:enrollments?.evidence||workflows?'3mb':'100kb'});
  if(smsWebhooks)app.useBodyParser('urlencoded',{extended:false,limit:'16kb',parameterLimit:100});
  if (corsOrigin) {
    const origin = new URL(corsOrigin);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== corsOrigin) throw new Error('CORS_ORIGIN must be one exact HTTP(S) origin.');
    app.enableCors({ origin: corsOrigin, methods: ['GET', 'POST', 'PUT'], allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'] });
  }
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new ApiErrors());
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store'); next();
  });
  app.enableShutdownHooks();
  return app;
}
