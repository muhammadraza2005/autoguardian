import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

export interface AccountStore {
  load(authUserId: string, provision: boolean): Promise<unknown>;
}

export class PostgresAccountStore implements AccountStore {
  constructor(private readonly pool: Pool, private readonly tenantId: string) {}

  async checkConnection(): Promise<void> {
    const { rows } = await this.pool.query(`select r.rolname, r.rolsuper, r.rolbypassrls,
      pg_has_role(current_user, 'autoguardian_identity_api', 'MEMBER') as member
      from pg_roles r where r.rolname = current_user`);
    const role = rows[0];
    if (!role || role.rolsuper || role.rolbypassrls || role.rolname === 'postgres' || !role.member) {
      throw new Error('DATABASE_URL must use the restricted identity login, not migration/admin credentials.');
    }
  }

  async load(authUserId: string, provision: boolean): Promise<unknown> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role autoguardian_identity_api');
      await client.query(`select set_config('autoguardian.tenant_id', $1, true),
        set_config('autoguardian.auth_user_id', $2, true)`, [this.tenantId, authUserId]);
      const tenant = await client.query(`select id from app.tenants where id=$1 and status='ACTIVE' and deleted_at is null`, [this.tenantId]);
      if (!tenant.rowCount) throw new ForbiddenException({ code: 'AUTHORITY_UNAVAILABLE' });
      if (provision) {
        await client.query(`insert into app.users (tenant_id, auth_user_id) values ($1,$2)
          on conflict (tenant_id, auth_user_id) do nothing`, [this.tenantId, authUserId]);
      }
      const user = await client.query(`select id, tenant_id, preferred_language, status, deleted_at
        from app.users where tenant_id=$1 and auth_user_id=$2`, [this.tenantId, authUserId]);
      if (!user.rowCount) throw new NotFoundException({ code: 'PROFILE_NOT_CREATED' });
      let profile = user.rows[0];
      if (profile.status !== 'ACTIVE' || profile.deleted_at) throw new ForbiddenException({ code: 'ACCOUNT_INACTIVE' });
      const locked = await client.query(`select id, tenant_id, preferred_language, status, deleted_at
        from app.users where tenant_id=$1 and auth_user_id=$2 for update`, [this.tenantId, authUserId]);
      if (!locked.rowCount) throw new ForbiddenException({ code: 'ACCOUNT_INACTIVE' });
      profile = locked.rows[0];
      if (provision) await this.provisionVerifier(client, profile.id);
      const roles = await client.query(`select role_code, organization_id from app.role_assignments
        where tenant_id=$1 and user_id=$2 and deleted_at is null and valid_from <= now()
          and (valid_to is null or valid_to > now()) order by role_code, organization_id`, [this.tenantId, profile.id]);
      await client.query('commit');
      return { id: profile.id, tenantId: profile.tenant_id,
        preferredLanguage: profile.preferred_language, roles: roles.rows.map((r) => ({
          code: r.role_code, organizationId: r.organization_id,
        })) };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally { client.release(); }
  }

  private async provisionVerifier(client: PoolClient, userId: string): Promise<void> {
    // Repeated setup requests must not restore an administrator-revoked assignment.
    const history = await client.query(`select id from app.role_assignments
      where tenant_id=$1 and user_id=$2 and role_code='VERIFIER' and organization_id is null`, [this.tenantId, userId]);
    if (history.rowCount) return;
    await client.query(`insert into app.role_assignments (tenant_id,user_id,role_code)
      values ($1,$2,'VERIFIER')`, [this.tenantId, userId]);
    await client.query(`insert into private.identity_events (tenant_id,user_id,auth_user_id,action)
      values ($1,$2,$3,'VERIFIER_PROVISIONED')`, [this.tenantId, userId,
        (await client.query(`select auth_user_id from app.users where id=$1`, [userId])).rows[0].auth_user_id]);
  }
}
