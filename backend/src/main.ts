import { Pool } from 'pg';
import { createApp } from './app';
import { PostgresAccountStore } from './account';
import { SupabaseIdentityVerifier, developmentEmailAllowed } from './auth';
import { PostgresVehicleStore } from './vehicles';
import { DevelopmentDraftVerifier, PostgresEnrollmentStore } from './enrollments';
import { configuredEvidence, PostgresEvidenceStore } from './evidence';
import { PostgresSealStore } from './seals';
import { PostgresReadinessStore } from './readiness';
import { configuredOwner, PostgresOwnerStore } from './owner';
import { PostgresSubmissionStore } from './submission';
import { PostgresRegistrationReviewStore, RegistrationReviewService } from './registrationReviews';

async function main() {
  const allowDevelopmentEmail = developmentEmailAllowed(process.env);
  const required = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'DATABASE_URL', 'AUTOGUARDIAN_TENANT_ID'] as const;
  for (const key of required) if (!process.env[key]?.trim()) throw new Error(`Missing ${key}`);
  const tenant = process.env.AUTOGUARDIAN_TENANT_ID!;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenant)) throw new Error('Invalid AUTOGUARDIAN_TENANT_ID');
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5,
    connectionTimeoutMillis: 10000, query_timeout: 10000, statement_timeout: 10000 });
  const accounts = new PostgresAccountStore(pool, tenant);
  try {
    await accounts.checkConnection();
    const identity = new SupabaseIdentityVerifier(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, allowDevelopmentEmail);
    const evidence=configuredEvidence(process.env,new PostgresEvidenceStore(pool,tenant),allowDevelopmentEmail);
    const app = await createApp(identity, accounts, process.env.CORS_ORIGIN,
      new PostgresVehicleStore(pool, tenant), { auth: new DevelopmentDraftVerifier(identity,allowDevelopmentEmail),
        store: new PostgresEnrollmentStore(pool,tenant), seals:new PostgresSealStore(pool,tenant),
        readiness: new PostgresReadinessStore(pool,tenant),
        submission: new PostgresSubmissionStore(pool,tenant),
        owner: configuredOwner(process.env,new PostgresOwnerStore(pool,tenant),allowDevelopmentEmail),
        evidence, registrationReviews:new RegistrationReviewService(new PostgresRegistrationReviewStore(pool,tenant),evidence) });
    const shutdown = app.close.bind(app);
    app.close = async () => { await shutdown(); await pool.end(); };
    await app.listen(port, process.env.HOST ?? '127.0.0.1');
    console.log(`AutoGuardian API listening on port ${port}`);
  } catch (error) { await pool.end(); throw error; }
}
void main().catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
