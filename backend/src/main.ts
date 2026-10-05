import { Pool } from 'pg';
import { createApp } from './app';
import { PostgresAccountStore } from './account';
import { SupabaseIdentityVerifier } from './auth';

async function main() {
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
    const app = await createApp(new SupabaseIdentityVerifier(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!), accounts);
    const shutdown = app.close.bind(app);
    app.close = async () => { await shutdown(); await pool.end(); };
    await app.listen(port, process.env.HOST ?? '127.0.0.1');
    console.log(`AutoGuardian API listening on port ${port}`);
  } catch (error) { await pool.end(); throw error; }
}
void main().catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
