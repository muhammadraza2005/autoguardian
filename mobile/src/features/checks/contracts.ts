import {z} from 'zod';
import type {AuthenticatedRequest} from '../../services/api/client';

export const safeVehicle=z.object({id:z.uuid(),chassisIdentifier:z.string(),plate:z.string().nullable(),category:z.string(),
  make:z.string().nullable(),model:z.string().nullable(),manufactureYear:z.number().nullable(),color:z.string().nullable(),
  saleStatus:z.enum(['NOT_FOR_SALE','FOR_SALE','AGENT_SALE','REPORTED_MISSING']),recordStatus:z.enum(['PENDING_REVIEW','ACTIVE','SUSPENDED_UNPAID','BLOCKED','ARCHIVED'])}).strict();
export const checkResult=z.object({id:z.uuid(),outcome:z.enum(['pending','approved','refused','timed_out']),responseDeadlineAt:z.iso.datetime({offset:true}),
  respondedAt:z.iso.datetime({offset:true}).nullable(),resultExpiresAt:z.iso.datetime({offset:true}).nullable(),expired:z.boolean(),authorizationUsable:z.boolean(),sampleOnly:z.literal(true),vehicle:safeVehicle.nullable()}).strict();
export type CheckResult=z.infer<typeof checkResult>;
export const inboxItem=z.object({id:z.uuid(),vehicleId:z.uuid(),plate:z.string().nullable(),responseDeadlineAt:z.iso.datetime({offset:true}),sampleOnly:z.literal(true)}).strict();
export const reportItem=z.object({id:z.uuid(),vehicleId:z.uuid(),kind:z.enum(['incident','missing','recovered']),occurredAt:z.string(),description:z.string(),status:z.enum(['submitted','accepted','rejected']),createdAt:z.string(),
  evidence:z.array(z.object({id:z.uuid(),mimeType:z.enum(['image/jpeg','application/pdf']),byteSize:z.number()})),
  history:z.array(z.object({action:z.string(),reason:z.string().nullable(),createdAt:z.string()}))});
export function checkView(result:CheckResult,now=Date.now()){
  const expired=result.expired||(result.resultExpiresAt!==null&&Date.parse(result.resultExpiresAt)<=now);
  return {expired,remaining:Math.max(0,Math.ceil((Date.parse(result.responseDeadlineAt)-now)/1000)),
    // Development checks never become usable production sale authorizations.
    outcome:expired?'expired':result.outcome,usable:!result.sampleOnly&&!expired&&result.authorizationUsable};
}
export async function readCheck(request:AuthenticatedRequest,id:string,signal?:AbortSignal){
  z.uuid().parse(id);return checkResult.parse(await request('/v1/vehicle-checks/'+id,{signal}));
}
