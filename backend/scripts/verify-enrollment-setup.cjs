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
       'draft_seal_locations_read', 'save_draft_seal_locations', 'development_evidence_reviews_read', 'save_development_evidence_review',
       'native_evidence_upload_context', 'enrollment_attachment_reserve_bound', 'enrollment_attachment_finish_bound',
       'enrollment_submission_status','enrollment_submit','enrollment_finalize',
       'registration_review_queue','registration_review_read','registration_review_change','registration_review_feedback')`);
    const found = name => functions.rows.find(row => row.proname === name);
    result.migration011ChecklistPresent = Boolean(found('enrollment_evidence_checklist'));
    result.migration012ValidationPresent = Boolean(found('validate_draft_seal_fitting'));
    result.migration013LocationsPresent = Boolean(found('draft_seal_locations_read') && found('save_draft_seal_locations'));
    result.migration014ReviewsPresent = Boolean(found('development_evidence_reviews_read') && found('save_development_evidence_review'));
    result.migration015NativeUploadsPresent = Boolean(found('native_evidence_upload_context')
      && found('enrollment_attachment_reserve_bound') && found('enrollment_attachment_finish_bound'));
    result.migration016FinalizationPresent = Boolean(found('enrollment_submission_status') && found('enrollment_submit') && found('enrollment_finalize'));
    result.migration017IndependentReviewsPresent = ['registration_review_queue','registration_review_read','registration_review_change','registration_review_feedback'].every(name=>Boolean(found(name)));
    result.fittingReturnsValidation = Boolean(found('draft_seal_fitting_read')?.definition.includes('sealValidation'));
    result.readinessReturnsValidation = Boolean(found('enrollment_readiness')?.definition.includes('sealValidation'));
    // The checklist is executor-internal; only the public API entrypoints
    // should be callable by the runtime API role.
    result.functionsRestricted = functions.rows.length === 18 && functions.rows.every(row =>
      row.api === (row.proname !== 'enrollment_evidence_checklist') && !row.anon && !row.authenticated && !row.service);
    const reviewTable = await client.query(`select c.relrowsecurity, c.relforcerowsecurity,
      has_table_privilege('autoguardian_enrollment_executor', c.oid, 'SELECT') executor_read,
      has_table_privilege('autoguardian_enrollment_executor', c.oid, 'INSERT') executor_append,
      has_table_privilege('autoguardian_enrollment_executor', c.oid, 'UPDATE') executor_update,
      has_table_privilege('autoguardian_enrollment_executor', c.oid, 'DELETE') executor_delete,
      has_table_privilege('autoguardian_enrollment_executor', c.oid, 'TRUNCATE') executor_truncate,
      exists (select 1 from unnest(array['anon', 'authenticated', 'service_role', 'autoguardian_enrollment_api']) role_name
        where has_table_privilege(role_name, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) exposed
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'private' and c.relname = 'development_evidence_reviews'`);
    const reviews = reviewTable.rows[0];
    result.reviewTableForcedRLS = Boolean(reviews?.relrowsecurity && reviews?.relforcerowsecurity);
    result.reviewTableAppendOnly = Boolean(reviews?.executor_read && reviews?.executor_append
      && !reviews.executor_update && !reviews.executor_delete && !reviews.executor_truncate);
    result.reviewTableNotExposed = Boolean(reviews && !reviews.exposed);
    const reviewPolicies = await client.query(`select policyname, roles::text[] as roles, cmd, qual, with_check
      from pg_policies where schemaname = 'private' and tablename = 'development_evidence_reviews'`);
    result.reviewPoliciesPresent = reviewPolicies.rows.length === 2 && ['evidence_reviews_read', 'evidence_reviews_append']
      .every(name => reviewPolicies.rows.some(row => row.policyname === name
        && row.roles.length === 1 && row.roles[0] === 'autoguardian_enrollment_executor'
        && row.cmd === (name === 'evidence_reviews_read' ? 'SELECT' : 'INSERT')
        && (name === 'evidence_reviews_read' ? row.qual : row.with_check)));
    const nativeTable = await client.query(`select c.relrowsecurity and c.relforcerowsecurity rls,
      has_table_privilege('autoguardian_enrollment_executor', c.oid, 'SELECT')
        and has_table_privilege('autoguardian_enrollment_executor', c.oid, 'INSERT')
        and not has_table_privilege('autoguardian_enrollment_executor', c.oid, 'UPDATE,DELETE,TRUNCATE') append_only,
      not exists(select 1 from unnest(array['anon','authenticated','service_role','autoguardian_enrollment_api']) role_name
        where has_table_privilege(role_name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) restricted
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='private' and c.relname='native_evidence_upload_bindings'`);
    result.nativeUploadTableRestricted = Boolean(nativeTable.rows[0]?.rls && nativeTable.rows[0]?.append_only && nativeTable.rows[0]?.restricted);
    const registrationTables = await client.query(`select c.relname,c.relrowsecurity and c.relforcerowsecurity rls,
      not exists(select 1 from unnest(array['anon','authenticated','service_role','autoguardian_enrollment_api']) r
        where has_table_privilege(r,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) restricted,
      not has_table_privilege('autoguardian_enrollment_executor',c.oid,'DELETE,TRUNCATE') cannot_remove,
      case when c.relname='enrollment_prerequisite_receipts' then
        not has_table_privilege('autoguardian_enrollment_executor',c.oid,'INSERT,UPDATE') else true end cannot_forge
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private'
      and c.relname in ('enrollment_prerequisite_receipts','enrollment_submissions','enrollment_finalization_events')`);
    result.finalizationTablesRestricted = registrationTables.rows.length===3 && registrationTables.rows.every(r=>r.rls&&r.restricted&&r.cannot_remove&&r.cannot_forge);
    const mode = await client.query(`select not has_column_privilege('autoguardian_enrollment_api',c.oid,a.attname,'INSERT,UPDATE') restricted
      from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
      where n.nspname='app' and c.relname='enrollment_drafts' and a.attname='enrollment_mode' and not a.attisdropped`);
    result.developmentPromotionDenied = Boolean(mode.rows[0]?.restricted);
    const independent=await client.query(`select c.relrowsecurity and c.relforcerowsecurity rls,
      has_table_privilege('autoguardian_review_executor',c.oid,'SELECT') and has_table_privilege('autoguardian_review_executor',c.oid,'INSERT')
        and not has_table_privilege('autoguardian_review_executor',c.oid,'UPDATE,DELETE,TRUNCATE') append_only,
      not exists(select 1 from unnest(array['anon','authenticated','service_role','autoguardian_enrollment_api']) r
        where has_table_privilege(r,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) restricted
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname='registration_review_events'`);
    result.independentReviewTableRestricted=Boolean(independent.rows[0]?.rls&&independent.rows[0]?.append_only&&independent.rows[0]?.restricted);
    const reviewerRole=await client.query(`select not rolsuper and not rolbypassrls and not rolcanlogin restricted,
      not pg_has_role('autoguardian_identity_login',oid,'MEMBER') runtime_cannot_assume from pg_roles where rolname='autoguardian_review_executor'`);
    result.independentReviewExecutorRestricted=Boolean(reviewerRole.rows[0]?.restricted&&reviewerRole.rows[0]?.runtime_cannot_assume);
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
