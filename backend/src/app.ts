import 'reflect-metadata';
import { BadRequestException, Body, Catch, Controller, ExceptionFilter, Get, Headers, HttpException,
  HttpCode, Inject, Module, Post, Put, ArgumentsHost, Param, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { EvidenceService } from './evidence';
import { AccountStore } from './account';
import { IdentityVerifier } from './auth';
import { VehicleStore, vehicleId, vehiclePage } from './vehicles';
import { EnrollmentStore, draftId, draftInput } from './enrollments';
import { SealStore, sealFittingInput, sealLocationInput } from './seals';
import { ReadinessStore } from './readiness';
import { OwnerService } from './owner';
import { SubmissionStore, submissionInput } from './submission';
import { RegistrationReviewService } from './registrationReviews';

@Controller('registration-reviews')
class RegistrationReviewController {
  constructor(@Inject('AUTH') private readonly auth: IdentityVerifier,
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
  constructor(@Inject('AUTH') private readonly auth: IdentityVerifier,
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

export async function createApp(auth: IdentityVerifier, accounts: AccountStore, corsOrigin?: string, vehicles?: VehicleStore,
  enrollments?: { auth: IdentityVerifier; store: EnrollmentStore; evidence?:EvidenceService; seals?:SealStore; readiness?:ReadinessStore; owner?:OwnerService; submission?:SubmissionStore; registrationReviews?:RegistrationReviewService }) {
  @Module({ controllers: [AccountController, ...(vehicles ? [VehicleController] : []), ...(enrollments ? [EnrollmentController] : []),
    ...(enrollments?.evidence?[EvidenceController]:[]),...(enrollments?.seals?[SealStockController,SealFittingController]:[]),
    ...(enrollments?.readiness?[ReadinessController]:[]), ...(enrollments?.owner?[OwnerController]:[]), ...(enrollments?.submission?[SubmissionController]:[]),
    ...(enrollments?.registrationReviews?[RegistrationReviewController]:[])], providers: [
    { provide: 'AUTH', useValue: auth }, { provide: 'ACCOUNTS', useValue: accounts },
    ...(vehicles ? [{ provide: 'VEHICLES', useValue: vehicles }] : []),
    ...(enrollments ? [{provide:'DRAFT_AUTH',useValue:enrollments.auth},{provide:'ENROLLMENTS',useValue:enrollments.store}] : []),
    ...(enrollments?.evidence?[{provide:'EVIDENCE',useValue:enrollments.evidence}]:[]),
    ...(enrollments?.seals?[{provide:'SEALS',useValue:enrollments.seals}]:[]),
    ...(enrollments?.readiness?[{provide:'READINESS',useValue:enrollments.readiness}]:[]),
    ...(enrollments?.owner?[{provide:'OWNER',useValue:enrollments.owner}]:[]),
    ...(enrollments?.submission?[{provide:'SUBMISSION',useValue:enrollments.submission}]:[]),
    ...(enrollments?.registrationReviews?[{provide:'REGISTRATION_REVIEWS',useValue:enrollments.registrationReviews}]:[]),
  ] }) class AppModule {}
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  app.useBodyParser('json',{limit:enrollments?.evidence?'3mb':'100kb'});
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
