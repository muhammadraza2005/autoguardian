import {BadRequestException,Body,Controller,Get,Headers,HttpCode,Inject,Param,Post,Query} from '@nestjs/common';
import {IdentityVerifier} from './auth';
import {CheckService,ReportEvidenceService,checkLookup,fields,workflowText} from './checks';
import {draftId} from './enrollments';
import {vehiclePage} from './vehicles';

@Controller('vehicle-checks')
export class CheckController{
  constructor(@Inject('WORKFLOW_AUTH') private readonly auth:IdentityVerifier,@Inject('CHECKS') private readonly checks:CheckService){}
  private query(q:Record<string,unknown>){if(Object.keys(q).length)throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});}
  @Post() @HttpCode(200) async create(@Headers('authorization') h:string|undefined,@Headers('idempotency-key') key:string|undefined,@Body() body:unknown,@Query() q:Record<string,unknown>){
    const actor=await this.auth.verify(h);this.query(q);return this.checks.create(actor,draftId(key),checkLookup(body));
  }
  @Get() async list(@Headers('authorization') h:string|undefined,@Query() q:Record<string,unknown>){
    const actor=await this.auth.verify(h),page=vehiclePage(q);return this.checks.list(actor,false,page.cursor??null,page.limit);
  }
  @Get(':id') async read(@Headers('authorization') h:string|undefined,@Param('id') id:string,@Query() q:Record<string,unknown>){
    const actor=await this.auth.verify(h);this.query(q);return this.checks.read(actor,draftId(id));
  }
}
@Controller('me/check-requests')
export class CheckInboxController{
  constructor(@Inject('WORKFLOW_AUTH') private readonly auth:IdentityVerifier,@Inject('CHECKS') private readonly checks:CheckService){}
  @Get() async list(@Headers('authorization') h:string|undefined,@Query() q:Record<string,unknown>){
    const actor=await this.auth.verify(h),page=vehiclePage(q);return this.checks.list(actor,true,page.cursor??null,page.limit);
  }
  @Post(':id/decision') @HttpCode(200) async decide(@Headers('authorization') h:string|undefined,@Param('id') id:string,@Body() body:unknown,@Query() q:Record<string,unknown>){
    const actor=await this.auth.verify(h);if(Object.keys(q).length)throw new BadRequestException({code:'UNEXPECTED_QUERY_FIELDS'});
    const v=fields(body,['decision']);if(!['approved','refused'].includes(v.decision as string))throw new BadRequestException({code:'INVALID_CHECK_DECISION'});
    return this.checks.decide(actor,draftId(id),v.decision as 'approved'|'refused');
  }
}
@Controller('me/vehicle-status')
export class VehicleStatusController{
  constructor(@Inject('WORKFLOW_AUTH') private readonly auth:IdentityVerifier,@Inject('CHECKS') private readonly checks:CheckService){}
  @Get(':id/history') async history(@Headers('authorization') h:string|undefined,@Param('id') id:string,@Query() q:Record<string,unknown>){
    const actor=await this.auth.verify(h);if(Object.keys(q).length)throw new BadRequestException();
    return this.checks.store.call(actor,'read_vehicle_status_history',[draftId(id)]);
  }
  @Post(':id') @HttpCode(200) async change(@Headers('authorization') h:string|undefined,@Param('id') id:string,@Headers('idempotency-key') key:string|undefined,@Body() body:unknown,@Query() q:Record<string,unknown>){
    const actor=await this.auth.verify(h);if(Object.keys(q).length)throw new BadRequestException();
    const v=fields(body,['expectedStatus','saleStatus','reason']);
    return this.checks.store.call(actor,'change_vehicle_sale',[draftId(id),draftId(key),workflowText(v.expectedStatus,32),workflowText(v.saleStatus,32),workflowText(v.reason,500,3)]);
  }
}
@Controller('vehicle-reports')
export class VehicleReportController{
  constructor(@Inject('WORKFLOW_AUTH') private readonly auth:IdentityVerifier,@Inject('CHECKS') private readonly checks:CheckService,@Inject('REPORT_EVIDENCE') private readonly evidence:ReportEvidenceService){}
  private query(q:Record<string,unknown>){if(Object.keys(q).length)throw new BadRequestException();}
  @Get() async list(@Headers('authorization') h:string|undefined,@Query() q:Record<string,unknown>){
    const actor=await this.auth.verify(h);this.query(q);return this.checks.store.call(actor,'read_vehicle_reports',[false,null]);
  }
  @Post() @HttpCode(200) async create(@Headers('authorization') h:string|undefined,@Headers('idempotency-key') key:string|undefined,@Body() body:unknown,@Query() q:Record<string,unknown>){
    const actor=await this.auth.verify(h);this.query(q);const v=fields(body,['vehicleId','kind','occurredAt','description']);
    if(!['incident','missing','recovered'].includes(v.kind as string)||typeof v.occurredAt!=='string'||!/^\d{4}-\d\d-\d\dT/.test(v.occurredAt)||!Number.isFinite(Date.parse(v.occurredAt)))throw new BadRequestException({code:'INVALID_REPORT'});
    return this.checks.store.call(actor,'submit_vehicle_report',[draftId(v.vehicleId),draftId(key),v.kind,v.occurredAt,workflowText(v.description,2000,3)]);
  }
  @Post(':id/evidence') @HttpCode(200) async upload(@Headers('authorization') h:string|undefined,@Param('id') id:string,@Headers('idempotency-key') key:string|undefined,@Body() body:unknown,@Query() q:Record<string,unknown>){
    const actor=await this.auth.verify(h);this.query(q);return this.evidence.upload(actor,draftId(id),draftId(key),body);
  }
  @Get('evidence/:id') async read(@Headers('authorization') h:string|undefined,@Param('id') id:string,@Query() q:Record<string,unknown>){
    const actor=await this.auth.verify(h);this.query(q);return this.evidence.read(actor,draftId(id),false);
  }
}
@Controller('vehicle-report-reviews')
export class VehicleReportReviewController{
  constructor(@Inject('WORKFLOW_STAFF_AUTH') private readonly auth:IdentityVerifier,@Inject('CHECKS') private readonly checks:CheckService,@Inject('REPORT_EVIDENCE') private readonly evidence:ReportEvidenceService){}
  private query(q:Record<string,unknown>){if(Object.keys(q).length)throw new BadRequestException();}
  @Get() async list(@Headers('authorization') h:string|undefined,@Query() q:Record<string,unknown>){const actor=await this.auth.verify(h);this.query(q);return this.checks.store.call(actor,'read_vehicle_reports',[true,null]);}
  @Get('evidence/:id') async read(@Headers('authorization') h:string|undefined,@Param('id') id:string,@Query() q:Record<string,unknown>){const actor=await this.auth.verify(h);this.query(q);return this.evidence.read(actor,draftId(id),true);}
  @Post(':id') @HttpCode(200) async review(@Headers('authorization') h:string|undefined,@Param('id') id:string,@Headers('idempotency-key') key:string|undefined,@Body() body:unknown,@Query() q:Record<string,unknown>){
    const actor=await this.auth.verify(h);this.query(q);const v=fields(body,['status','reason']);
    return this.checks.store.call(actor,'review_vehicle_report',[draftId(id),draftId(key),workflowText(v.status,16),workflowText(v.reason,500,3)]);
  }
}
