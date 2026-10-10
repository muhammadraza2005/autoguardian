import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { EvidenceService } from './evidence';

export type RegistrationReviewInput = {
  expectedDraftRevision: number; expectedSnapshotRevision: number; expectedReviewRevision: number;
  action: 'READ_REQUESTED' | 'ACCEPTED' | 'NEEDS_CORRECTION' | 'SUPERSEDED' | 'APPROVED';
  attachmentId: string | null; replacementId: string | null;
  reason: 'BLURRY' | 'INCOMPLETE' | 'WRONG_DOCUMENT' | 'DETAILS_MISMATCH' | null;
  inspected: boolean;
};
export function registrationReviewInput(body: unknown): RegistrationReviewInput {
  const invalid = () => new BadRequestException({ code: 'INVALID_REVIEW' });
  const keys = ['expectedDraftRevision','expectedSnapshotRevision','expectedReviewRevision','action','attachmentId','replacementId','reason','inspected'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== keys.length || Object.keys(body).some(k => !keys.includes(k))) throw invalid();
  const value = body as RegistrationReviewInput;
  for (const [key, minimum] of [['expectedDraftRevision',1],['expectedSnapshotRevision',1],['expectedReviewRevision',0]] as const)
    if (!Number.isInteger(value[key]) || value[key]<minimum || value[key]>=2147483647) throw invalid();
  const uuid = (id: unknown) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (!['READ_REQUESTED','ACCEPTED','NEEDS_CORRECTION','SUPERSEDED','APPROVED'].includes(value.action)
    || (value.action === 'APPROVED' ? value.attachmentId !== null : !uuid(value.attachmentId))
    || (value.action === 'SUPERSEDED' ? !uuid(value.replacementId) : value.replacementId !== null)
    || (value.action === 'NEEDS_CORRECTION' ? !['BLURRY','INCOMPLETE','WRONG_DOCUMENT','DETAILS_MISMATCH'].includes(value.reason ?? '') : value.reason !== null)
    || typeof value.inspected !== 'boolean' || (value.action === 'READ_REQUESTED' ? value.inspected : !value.inspected)) throw invalid();
  return value;
}
export class PostgresRegistrationReviewStore {
  constructor(private readonly pool: Pool, private readonly tenantId: string) {}
  queue(actor: string, limit: number, offset: number) { return this.call(actor,'queue',[limit,offset]); }
  read(actor: string, id: string) { return this.call(actor,'read',[id]); }
  feedback(actor: string, id: string) { return this.call(actor,'feedback',[id]); }
  change(actor: string, id: string, key: string, input: RegistrationReviewInput) {
    return this.call(actor,'change',[id,key,input.expectedDraftRevision,input.expectedSnapshotRevision,input.expectedReviewRevision,
      input.action,input.attachmentId,input.reason,input.replacementId]);
  }
  private async call(actor: string, action: 'queue'|'read'|'change'|'feedback', args: unknown[]): Promise<any> {
    const client = await this.pool.connect();
    try {
      await client.query('begin isolation level serializable');
      await client.query('set local role autoguardian_enrollment_api');
      await client.query("select set_config('autoguardian.tenant_id',$1,true),set_config('autoguardian.auth_user_id',$2,true)",[this.tenantId,actor]);
      const result = await client.query(`select private.registration_review_${action}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args);
      await client.query('commit'); return result.rows[0].result;
    } catch (error) {
      await client.query('rollback'); const code=(error as {code?:string}).code;
      if (code==='AG400') throw new BadRequestException({code:'INVALID_REVIEW'});
      if (code==='AG403') throw new ForbiddenException({code:'REVIEWER_ACCESS_REQUIRED'});
      if (code==='AG404') throw new NotFoundException({code:'REVIEW_NOT_FOUND'});
      if (['AG409','23505','40001','40P01'].includes(code??'')) throw new ConflictException({code:'REVIEW_CHANGED'});
      if (['42883','42P01','42703'].includes(code??'')) throw new ServiceUnavailableException({code:'REVIEW_SETUP_REQUIRED'});
      throw error;
    } finally {client.release();}
  }
}
export class RegistrationReviewService {
  constructor(private readonly store: PostgresRegistrationReviewStore, private readonly evidence: EvidenceService) {}
  queue(actor: string, limit: number, offset: number) { return this.store.queue(actor,limit,offset); }
  read(actor: string, id: string) { return this.store.read(actor,id); }
  feedback(actor: string, id: string) { return this.store.feedback(actor,id); }
  async change(actor: string, id: string, key: string, body: unknown) {
    const input=registrationReviewInput(body);
    const result=await this.store.change(actor,id,key,input);
    // Only an authorized, audited database read can supply a ciphertext row.
    if (input.action==='READ_REQUESTED') return this.evidence.readReviewRecord(result);
    return result;
  }
}
