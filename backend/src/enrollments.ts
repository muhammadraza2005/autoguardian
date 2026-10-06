import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { IdentityVerifier } from './auth';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function draftId(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new BadRequestException({ code: 'INVALID_DRAFT_ID' });
  return value.toLowerCase();
}
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new BadRequestException({ code: 'INVALID_DRAFT_FIELDS' });
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, required = false): string | null {
  if (!required && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new BadRequestException({ code: 'INVALID_DRAFT_FIELDS' });
  }
  return value.trim();
}
export function draftInput(value: unknown, update = false) {
  const body = object(value, ['organizationId','ownerProfileId','vehicle', ...(update ? ['expectedRevision'] : [])]);
  const v = object(body.vehicle, ['chassisIdentifier','plate','category','make','model','manufactureYear','color']);
  const year = v.manufactureYear ?? null;
  if (year !== null && (typeof year !== 'number' || !Number.isInteger(year) || year < 1886 || year > 2200)) {
    throw new BadRequestException({ code: 'INVALID_DRAFT_FIELDS' });
  }
  const revision = body.expectedRevision;
  if (update && (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1 || revision >= 2147483647)) {
    throw new BadRequestException({ code: 'INVALID_DRAFT_REVISION' });
  }
  return { organizationId: draftId(body.organizationId), ownerProfileId: draftId(body.ownerProfileId),
    vehicle: { chassisIdentifier: text(v.chassisIdentifier,128,true)!.toUpperCase(), plate: text(v.plate,64)?.toUpperCase() ?? null,
      category: text(v.category,64,true)!.toUpperCase(), make: text(v.make,100), model: text(v.model,100),
      manufactureYear: year as number | null, color: text(v.color,100) }, expectedRevision: update ? revision as number : undefined };
}
type DraftInput = ReturnType<typeof draftInput>;

// Agent password + OTP is still pending. Confirmed development identities are the
// only temporary path; an ordinary phone session must not unlock privileged production access.
export class DevelopmentDraftVerifier implements IdentityVerifier {
  constructor(private readonly identity: IdentityVerifier, private readonly enabled: boolean) {}
  async verify(header: string | undefined) {
    const subject = await this.identity.verify(header);
    if (!this.enabled) throw new ForbiddenException({ code: 'AGENT_AUTH_NOT_CONFIGURED' });
    return subject;
  }
}
export interface EnrollmentStore {
  ownerOptions(actor: string, organizationId: string): Promise<unknown>;
  list(actor: string, page: { limit: number; cursor?: string }): Promise<unknown>;
  detail(actor: string, id: string): Promise<unknown>;
  save(actor: string, input: DraftInput, id?: string, key?: string): Promise<unknown>;
}
const projection = `id, organization_id as "organizationId", owner_profile_id as "ownerProfileId", status, revision,
  created_at as "createdAt", updated_at as "updatedAt", jsonb_build_object('chassisIdentifier',chassis_identifier,
  'plate',plate,'category',category,'make',make,'model',model,'manufactureYear',manufacture_year,'color',color) as vehicle`;

export class PostgresEnrollmentStore implements EnrollmentStore {
  constructor(private readonly pool: Pool, private readonly tenantId: string) {}
  async ownerOptions(actor: string, organizationId: string) {
    return this.transaction(actor, async client => {
      const result = await client.query('select private.enrollment_owner_options($1) as options',[organizationId]);
      return result.rows[0].options;
    });
  }
  async list(actor: string, page: { limit: number; cursor?: string }) {
    return this.transaction(actor, async client => {
      const result = await client.query(`select ${projection} from app.enrollment_drafts
        where ($1::uuid is null or id>$1::uuid) order by id limit $2`, [page.cursor ?? null, page.limit+1]);
      const items = result.rows.slice(0,page.limit);
      return { items, nextCursor: result.rows.length>page.limit ? items.at(-1)?.id : null };
    });
  }
  async detail(actor: string, id: string) {
    return this.transaction(actor, async client => {
      const result = await client.query(`select ${projection} from app.enrollment_drafts where id=$1`, [id]);
      if (!result.rowCount) throw new NotFoundException({ code: 'DRAFT_NOT_FOUND' });
      return { draft: result.rows[0] };
    });
  }
  async save(actor: string, input: DraftInput, id?: string, key?: string) {
    const result = await this.transaction(actor, async client => {
      const response = await client.query('select private.save_enrollment_draft($1,$2,$3,$4,$5::jsonb,$6) as draft',
        [id ?? null, key ?? null, input.organizationId,input.ownerProfileId,JSON.stringify(input.vehicle),input.expectedRevision ?? null]);
      return response.rows[0].draft;
    });
    // Commit the rejected-duplicate event before returning a conflict to the caller.
    if (result.error === 'DUPLICATE_VEHICLE') throw new ConflictException({ code: 'DUPLICATE_VEHICLE' });
    return { draft: result };
  }
  private async transaction<T>(actor: string, read: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role autoguardian_enrollment_api');
      await client.query(`select set_config('autoguardian.tenant_id',$1,true),set_config('autoguardian.auth_user_id',$2,true)`,[this.tenantId,actor]);
      const allowed = await client.query('select private.enrollment_agent_id(null) as actor');
      if (!allowed.rows[0].actor) throw new ForbiddenException({ code: 'AGENT_ACCESS_REQUIRED' });
      const result = await read(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      const e = error as { code?: string; message?: string };
      const codes: Record<string,string> = { AG403:'AGENT_ACCESS_REQUIRED', AG404:'DRAFT_NOT_FOUND', AG422:'OWNER_PROFILE_UNAVAILABLE' };
      if (e.code === 'AG403') throw new ForbiddenException({ code: codes.AG403 });
      if (e.code === 'AG404') throw new NotFoundException({ code: codes.AG404 });
      if (e.code === 'AG422') throw new UnprocessableEntityException({ code: codes.AG422 });
      if (e.code === 'AG409') throw new ConflictException({ code: e.message === 'IDEMPOTENCY_CONFLICT' ? 'IDEMPOTENCY_CONFLICT' : 'DRAFT_CHANGED' });
      if (e.code === 'AG400' || e.code === '23514' || e.code === '22P02' || e.code === '22003') throw new BadRequestException({ code: 'INVALID_DRAFT_FIELDS' });
      throw error;
    } finally { client.release(); }
  }
}
