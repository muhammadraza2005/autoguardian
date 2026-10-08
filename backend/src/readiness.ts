import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';

export interface ReadinessStore {
  read(actor: string, draftId: string): Promise<unknown>;
}

export class PostgresReadinessStore implements ReadinessStore {
  constructor(private readonly pool: Pool, private readonly tenantId: string) {}
  async read(actor: string, draftId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role autoguardian_enrollment_api');
      await client.query("select set_config('autoguardian.tenant_id',$1,true),set_config('autoguardian.auth_user_id',$2,true)", [this.tenantId, actor]);
      const allowed = await client.query('select private.enrollment_agent_id(null) as actor');
      if (!allowed.rows[0].actor) throw new ForbiddenException({ code: 'AGENT_ACCESS_REQUIRED' });
      const result = await client.query('select private.enrollment_readiness($1) as result', [draftId]);
      if (result.rows[0].result?.evidenceChecklist?.version !== 1 || result.rows[0].result?.sealValidation?.version !== 1) {
        throw new ServiceUnavailableException({ code: 'READINESS_SETUP_REQUIRED' });
      }
      await client.query('commit');
      return result.rows[0].result;
    } catch (error) {
      await client.query('rollback');
      const code = (error as { code?: string }).code;
      if (code === 'AG403') throw new ForbiddenException({ code: 'AGENT_ACCESS_REQUIRED' });
      if (code === 'AG404') throw new NotFoundException({ code: 'DRAFT_NOT_FOUND' });
      if (code === '42883' || code === '42P01') throw new ServiceUnavailableException({ code: 'READINESS_SETUP_REQUIRED' });
      throw error;
    } finally { client.release(); }
  }
}
