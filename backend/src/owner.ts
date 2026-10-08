import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { Pool } from 'pg';

const invalid = () => new BadRequestException({ code: 'INVALID_OWNER_DETAILS' });
const unavailable = () => new ServiceUnavailableException({ code: 'OWNER_SETUP_REQUIRED' });
function object(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) throw invalid();
  return value.trim();
}
function revision(value: unknown) {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 2147483646) throw invalid();
  return value as number;
}
export type OwnerDetails = { type: 'INDIVIDUAL' | 'COMPANY'; name: string; companyRegistration: string | null;
  representativeName: string | null; idDocumentType: string; idDocumentNumber: string; phone: string; preferredLanguage: 'en' | 'fr' };
export function ownerDetailsInput(value: unknown): OwnerDetails {
  const v = object(value, ['type', 'name', 'companyRegistration', 'representativeName', 'idDocumentType', 'idDocumentNumber', 'phone', 'preferredLanguage']);
  if (!['INDIVIDUAL', 'COMPANY'].includes(v.type as string) || !['en', 'fr'].includes(v.preferredLanguage as string)) throw invalid();
  const phone = text(v.phone, 16);
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) throw invalid();
  if (v.type === 'INDIVIDUAL' && (v.companyRegistration != null || v.representativeName != null)) throw invalid();
  return { type: v.type as OwnerDetails['type'], name: text(v.name, 200),
    companyRegistration: v.type === 'COMPANY' ? text(v.companyRegistration, 100) : null,
    representativeName: v.type === 'COMPANY' ? text(v.representativeName, 200) : null,
    idDocumentType: text(v.idDocumentType, 64), idDocumentNumber: text(v.idDocumentNumber, 100),
    phone, preferredLanguage: v.preferredLanguage as OwnerDetails['preferredLanguage'] };
}
export function ownerSaveInput(value: unknown) {
  const v = object(value, ['expectedDraftRevision', 'details']);
  return { expectedDraftRevision: revision(v.expectedDraftRevision), details: ownerDetailsInput(v.details) };
}
export function ownerConsentInput(value: unknown) {
  const v = object(value, ['expectedDraftRevision', 'ownerGeneration', 'version', 'language', 'accept', 'termsAccepted', 'dataAccepted']);
  if (typeof v.accept !== 'boolean' || !['en', 'fr'].includes(v.language as string)
    || (v.accept ? v.termsAccepted !== true || v.dataAccepted !== true : v.termsAccepted != null || v.dataAccepted != null)) throw invalid();
  return { expectedDraftRevision: revision(v.expectedDraftRevision), ownerGeneration: revision(v.ownerGeneration),
    version: text(v.version, 100), language: v.language as 'en' | 'fr', accept: v.accept,
    ...(v.accept ? { termsAccepted: true, dataAccepted: true } : {}) };
}
type Snapshot = { draftId: string; draftRevision: number; ownerProfileId: string; ownerGeneration: number;
  ciphertext: string | null; savedAt: string | null; documents: unknown[]; consent: unknown;
  sampleOnly: true; phoneVerified: false; productionConsentVerified: false };
export function ownerCipher(master: Buffer) {
  if (master.length !== 32) throw new Error('Owner encryption requires a 32-byte master key.');
  // Separate encryption and keyed request fingerprints from the evidence key/domain.
  const key = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'AutoGuardian/owner-details/v1', 32));
  const hashKey = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'AutoGuardian/owner-requests/v1', 32));
  return {
    digest: (value: unknown) => createHmac('sha256', hashKey).update(JSON.stringify(value)).digest('hex'),
    encrypt(value: OwnerDetails, context: unknown[]) {
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(Buffer.from(JSON.stringify(context)));
      const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return Buffer.concat([Buffer.from('AO01'), nonce, cipher.getAuthTag(), bytes]).toString('base64');
    },
    decrypt(encoded: string, context: unknown[]) {
      try {
        const bytes = Buffer.from(encoded, 'base64');
        if (bytes.length < 33 || bytes.length > 12000 || bytes.subarray(0, 4).toString() !== 'AO01') throw unavailable();
        const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(4, 16));
        cipher.setAAD(Buffer.from(JSON.stringify(context))); cipher.setAuthTag(bytes.subarray(16, 32));
        return ownerDetailsInput(JSON.parse(Buffer.concat([cipher.update(bytes.subarray(32)), cipher.final()]).toString('utf8')));
      } catch { throw unavailable(); }
    },
  };
}
export class PostgresOwnerStore {
  constructor(private readonly pool: Pool, readonly tenantId: string) {}
  read(actor: string, id: string) { return this.call(actor, 'draft_owner_read', [id]); }
  save(actor: string, id: string, key: string, expected: number, digest: string, ciphertext: string) {
    return this.call(actor, 'draft_owner_save', [id, key, expected, digest, ciphertext]);
  }
  consent(actor: string, id: string, key: string, input: ReturnType<typeof ownerConsentInput>, digest: string) {
    return this.call(actor, 'draft_owner_consent', [id, key, input.expectedDraftRevision, input.ownerGeneration, digest, input.version, input.language, input.accept]);
  }
  private async call(actor: string, name: string, args: unknown[]): Promise<Snapshot> {
    const client = await this.pool.connect();
    try {
      await client.query('begin'); await client.query('set local role autoguardian_enrollment_api');
      await client.query("select set_config('autoguardian.tenant_id',$1,true),set_config('autoguardian.auth_user_id',$2,true)", [this.tenantId, actor]);
      const access = await client.query('select private.enrollment_agent_id(null) as actor');
      if (!access.rows[0].actor) throw new ForbiddenException({ code: 'AGENT_ACCESS_REQUIRED' });
      const result = await client.query(`select private.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as result`, args);
      await client.query('commit'); return result.rows[0].result;
    } catch (error) {
      await client.query('rollback'); const code = (error as { code?: string }).code;
      if (code === 'AG404') throw new NotFoundException({ code: 'DRAFT_NOT_FOUND' });
      if (code === 'AG403') throw new ForbiddenException({ code: 'AGENT_ACCESS_REQUIRED' });
      if (code === 'AG422') throw new UnprocessableEntityException({ code: 'OWNER_PROFILE_UNAVAILABLE' });
      if (code === 'AG409' || code === '23505') throw new ConflictException({ code: 'OWNER_CONFLICT' });
      if (code === 'AG400' || code === '23514') throw invalid();
      if (code === '42883' || code === '42P01' || code === '42703') throw unavailable();
      throw error;
    } finally { client.release(); }
  }
}
export class OwnerService {
  constructor(private readonly store: PostgresOwnerStore, private readonly cipher?: ReturnType<typeof ownerCipher>) {}
  private context(row: Snapshot) { return [this.store.tenantId.toLowerCase(), row.draftId, row.ownerProfileId, row.ownerGeneration]; }
  private present(row: Snapshot) {
    if (!this.cipher) throw unavailable();
    const { ciphertext, ...safe } = row;
    return { ...safe, details: ciphertext ? this.cipher.decrypt(ciphertext, this.context(row)) : null };
  }
  async read(actor: string, id: string) { return this.present(await this.store.read(actor, id)); }
  async save(actor: string, id: string, key: string, body: unknown) {
    const input = ownerSaveInput(body), row = await this.store.read(actor, id);
    if (!this.cipher) throw unavailable();
    const ciphertext = this.cipher.encrypt(input.details, this.context({ ...row, ownerGeneration: row.ownerGeneration + 1 }));
    return this.present(await this.store.save(actor, id, key, input.expectedDraftRevision,
      this.cipher.digest([this.store.tenantId, id, key, input]), ciphertext));
  }
  async consent(actor: string, id: string, key: string, body: unknown) {
    const input = ownerConsentInput(body), current = this.present(await this.store.read(actor, id));
    if (!current.details || current.details.preferredLanguage !== input.language) throw new ConflictException({ code: 'OWNER_CONFLICT' });
    return this.present(await this.store.consent(actor, id, key, input, this.cipher!.digest([this.store.tenantId, id, key, input])));
  }
}
export function configuredOwner(env: NodeJS.ProcessEnv, store: PostgresOwnerStore, development: boolean) {
  const key = env.ENROLLMENT_EVIDENCE_KEY_HEX;
  return new OwnerService(store, development && key && /^[0-9a-f]{64}$/i.test(key) ? ownerCipher(Buffer.from(key, 'hex')) : undefined);
}
