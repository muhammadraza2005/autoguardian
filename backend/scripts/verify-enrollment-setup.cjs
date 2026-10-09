// Read-only hosted development checks. Never prints connection strings or identities.
// Run from backend: node --env-file=.env scripts/verify-enrollment-setup.cjs
const { Pool } = require('pg');

async function main() {
  const result = { developmentEnvironment: process.env.NODE_ENV === 'development' };
  if (!result.developmentEnvironment || !process.env.DATABASE_URL) {
    console.log(JSON.stringify({ ...result, databaseConfigured: Boolean(process.env.DATABASE_URL) }));
    process.exitCode = 1;
    return;
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1,
    connectionTimeoutMillis: 10000, query_timeout: 10000, statement_timeout: 10000 });
  let client;
  try {
    client = await pool.connect();
    result.databaseTLSVerified = client.connection.stream.encrypted === true && client.connection.stream.authorized === true;
    await client.query('begin read only');
    const role = await client.query('select rolsuper, rolbypassrls from pg_roles where rolname = current_user');
    result.databaseRoleRestricted = role.rows.length === 1 && !role.rows[0].rolsuper && !role.rows[0].rolbypassrls;
    const functions = await client.query(`select p.proname, pg_get_functiondef(p.oid) definition,
      has_function_privilege('autoguardian_enrollment_api', p.oid, 'EXECUTE') api,
      has_function_privilege('anon', p.oid, 'EXECUTE') anon,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') authenticated,
      has_function_privilege('service_role', p.oid, 'EXECUTE') service
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname in
      ('enrollment_evidence_checklist', 'validate_draft_seal_fitting', 'draft_seal_fitting_read', 'enrollment_readiness',
       'draft_seal_locations_read', 'save_draft_seal_locations', 'development_evidence_reviews_read', 'save_development_evidence_review')`);
    const found = name => functions.rows.find(row => row.proname === name);
    result.migration011ChecklistPresent = Boolean(found('enrollment_evidence_checklist'));
    result.migration012ValidationPresent = Boolean(found('validate_draft_seal_fitting'));
    result.migration013LocationsPresent = Boolean(found('draft_seal_locations_read') && found('save_draft_seal_locations'));
    result.migration014ReviewsPresent = Boolean(found('development_evidence_reviews_read') && found('save_development_evidence_review'));
    result.fittingReturnsValidation = Boolean(found('draft_seal_fitting_read')?.definition.includes('sealValidation'));
    result.readinessReturnsValidation = Boolean(found('enrollment_readiness')?.definition.includes('sealValidation'));
    // The checklist is executor-internal; only the public API entrypoints
    // should be callable by the runtime API role.
    result.functionsRestricted = functions.rows.length >= 4 && functions.rows.every(row =>
      row.api === (row.proname !== 'enrollment_evidence_checklist') && !row.anon && !row.authenticated && !row.service);
    const policy = await client.query(`select 1 from pg_policies where schemaname = 'private'
      and tablename = 'draft_seal_placements' and policyname = 'assigned_stock_reservation_read'`);
    result.reassignedStockPolicyPresent = policy.rows.length === 1;
    await client.query('rollback');
  } catch (error) {
    result.failedStage = 'read-only database inspection';
    result.errorCode = /^[A-Z0-9_]{2,40}$/.test(error.code || '') ? error.code : 'CONNECTION_OR_QUERY_FAILED';
    if (client) await client.query('rollback').catch(() => {});
  } finally {
    client?.release();
    await pool.end();
  }
  if (!Object.values(result).every(value => value === true)) process.exitCode = 1;
  console.log(JSON.stringify(result));
}
void main().catch(() => { console.error('Enrollment setup verification failed; no credentials printed.'); process.exitCode = 1; });
