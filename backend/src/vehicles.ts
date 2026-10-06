import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function vehicleId(value: string): string {
  if (!uuid.test(value)) throw new BadRequestException({ code: 'INVALID_VEHICLE_ID' });
  return value.toLowerCase();
}
export function vehiclePage(query: Record<string, unknown>) {
  if (Object.keys(query).some(key => !['limit', 'cursor'].includes(key))) {
    throw new BadRequestException({ code: 'UNEXPECTED_QUERY_FIELDS' });
  }
  const value = query.limit ?? '20';
  if (typeof value !== 'string' || !/^[1-9]\d?$/.test(value) || Number(value) > 50) {
    throw new BadRequestException({ code: 'INVALID_PAGE_LIMIT' });
  }
  if (query.cursor !== undefined && (typeof query.cursor !== 'string' || !uuid.test(query.cursor))) {
    throw new BadRequestException({ code: 'INVALID_PAGE_CURSOR' });
  }
  return { limit: Number(value), cursor: query.cursor as string | undefined };
}
export interface VehicleStore {
  list(authUserId: string, page: { limit: number; cursor?: string }): Promise<unknown>;
  detail(authUserId: string, id: string): Promise<unknown>;
}
const projection = `v.id, v.chassis_identifier as "chassisIdentifier", v.current_plate as "plate",
  v.category, v.make, v.model, v.manufacture_year as "manufactureYear", v.color,
  v.sale_status as "saleStatus", v.record_status as "recordStatus",
  v.created_at as "createdAt", v.updated_at as "updatedAt", s.start_at as "ownedSince"`;

export class PostgresVehicleStore implements VehicleStore {
  constructor(private readonly pool: Pool, private readonly tenantId: string) {}
  async list(authUserId: string, page: { limit: number; cursor?: string }): Promise<unknown> {
    return this.read(authUserId, undefined, page);
  }
  async detail(authUserId: string, id: string): Promise<unknown> {
    return this.read(authUserId, id, { limit: 1 });
  }
  private async read(authUserId: string, id: string | undefined, page: { limit: number; cursor?: string }) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role autoguardian_vehicle_reader');
      await client.query(`select set_config('autoguardian.tenant_id', $1, true),
        set_config('autoguardian.auth_user_id', $2, true)`, [this.tenantId, authUserId]);
      const tenant = await client.query(`select id from app.tenants where id=$1`, [this.tenantId]);
      if (!tenant.rowCount) throw new ForbiddenException({ code: 'AUTHORITY_UNAVAILABLE' });
      const actor = await client.query(`select id from app.users where tenant_id=$1 and auth_user_id=$2`, [this.tenantId, authUserId]);
      if (!actor.rowCount) throw new ForbiddenException({ code: 'ACCOUNT_UNAVAILABLE' });
      const rows = await client.query(`select ${projection}
        from app.vehicles v
        join app.ownerships s on s.tenant_id=v.tenant_id and s.vehicle_id=v.id
        join private.owners o on o.tenant_id=s.tenant_id and o.id=s.owner_id
        where v.tenant_id=$1 and o.user_id=$2 and v.deleted_at is null
          and s.deleted_at is null and s.end_at is null and s.start_at <= now()
          and ($3::uuid is null or v.id=$3::uuid)
          and ($4::uuid is null or v.id>$4::uuid)
        order by v.id asc limit $5`, [this.tenantId, actor.rows[0].id, id ?? null, page.cursor ?? null, page.limit + 1]);
      if (id && !rows.rowCount) throw new NotFoundException({ code: 'VEHICLE_NOT_FOUND' });
      await client.query('commit');
      if (id) return { vehicle: rows.rows[0] };
      const items = rows.rows.slice(0, page.limit);
      return { items, nextCursor: rows.rows.length > page.limit ? items.at(-1)?.id : null };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally { client.release(); }
  }
}
