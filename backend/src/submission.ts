import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';

export function submissionInput(value: unknown): { expectedDraftRevision: number; expectedSnapshotRevision: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 2 || !('expectedDraftRevision' in value) || !('expectedSnapshotRevision' in value)
    || !Number.isInteger(value.expectedDraftRevision) || Number(value.expectedDraftRevision) < 1
    || Number(value.expectedDraftRevision) > 2147483647 || !Number.isInteger(value.expectedSnapshotRevision)
    || Number(value.expectedSnapshotRevision) < 1 || Number(value.expectedSnapshotRevision) > 2147483647) {
    throw new BadRequestException({ code: 'INVALID_SUBMISSION' });
  }
  return { expectedDraftRevision: Number(value.expectedDraftRevision), expectedSnapshotRevision: Number(value.expectedSnapshotRevision) };
}
export interface SubmissionStore {
  read(actor: string, draftId: string): Promise<unknown>;
  execute(actor: string, draftId: string, key: string, revision: number, action: 'submit' | 'finalize', snapshot: number): Promise<unknown>;
}
export class PostgresSubmissionStore implements SubmissionStore {
  constructor(private readonly pool: Pool, private readonly tenantId: string) {}
  read(actor: string, draftId: string) { return this.call(actor, draftId); }
  execute(actor: string, draftId: string, key: string, revision: number, action: 'submit' | 'finalize', snapshot: number) {
    return this.call(actor, draftId, { key, revision, action, snapshot });
  }
  private async call(actor: string, draftId: string, change?: { key: string; revision: number; action: 'submit' | 'finalize'; snapshot: number }) {
    const client = await this.pool.connect();
    try {
      await client.query('begin isolation level serializable');
      await client.query('set local role autoguardian_enrollment_api');
      await client.query("select set_config('autoguardian.tenant_id',$1,true),set_config('autoguardian.auth_user_id',$2,true)", [this.tenantId, actor]);
      const allowed = await client.query('select private.enrollment_agent_id(null) as actor');
      if (!allowed.rows[0].actor) throw new ForbiddenException({ code: 'AGENT_ACCESS_REQUIRED' });
      const result = await client.query(change
        ? `select private.enrollment_${change.action}($1,$2,$3,$4) as result`
        : 'select private.enrollment_submission_status($1) as result', change ? [draftId, change.key, change.revision, change.snapshot] : [draftId]);
      const value = result.rows[0].result;
      if (value?.blocked) throw new ConflictException({ code: 'ENROLLMENT_PREREQUISITES_REQUIRED', submission: value.submission });
      await client.query('commit');
      return value;
    } catch (error) {
      await client.query('rollback');
      const code = (error as { code?: string }).code;
      if (code === 'AG400') throw new BadRequestException({ code: 'INVALID_SUBMISSION' });
      if (code === 'AG403') throw new ForbiddenException({ code: 'AGENT_ACCESS_REQUIRED' });
      if (code === 'AG404') throw new NotFoundException({ code: 'DRAFT_NOT_FOUND' });
      if (code === 'AG409' || code === '23505') throw new ConflictException({ code: 'ENROLLMENT_CONFLICT' });
      if (code === '40001' || code === '40P01') throw new ConflictException({ code: 'ENROLLMENT_RETRY_REQUIRED' });
      if (code === '42883' || code === '42P01' || code === '42703') throw new ServiceUnavailableException({ code: 'SUBMISSION_SETUP_REQUIRED' });
      throw error;
    } finally { client.release(); }
  }
}
