import { createPublicKey } from 'node:crypto';
import { inspect } from 'node:util';

export interface PawaPayPublicKey { readonly id: string; readonly key: string }

/** Sandbox-only authenticated key retrieval. Never follows callback-supplied URLs. */
export class PawaPaySandboxPublicKeys {
  readonly #token: string;
  #keys: readonly PawaPayPublicKey[] | undefined;
  #expires = 0;
  #pending: Promise<readonly PawaPayPublicKey[]> | undefined;
  readonly #ttl: number;

  constructor(configuration: { token: string; ttlMs?: number },
    private readonly request: typeof fetch = fetch, private readonly clock: () => number = Date.now) {
    if (!configuration.token || /\s/.test(configuration.token)) throw new Error('A valid sandbox token is required.');
    this.#token = configuration.token;
    this.#ttl = configuration.ttlMs ?? 300000;
    if (!Number.isSafeInteger(this.#ttl) || this.#ttl < 1000 || this.#ttl > 3600000) throw new Error('Invalid signing key cache lifetime.');
  }

  [inspect.custom]() { return 'PawaPaySandboxPublicKeys { sandbox: true, token: [REDACTED] }'; }

  async getKeys(): Promise<readonly PawaPayPublicKey[]> {
    if (this.#keys && this.#expires > this.clock()) return this.#keys;
    if (this.#pending) return this.#pending;
    this.#pending = this.load();
    try { return await this.#pending; }
    finally { this.#pending = undefined; }
  }

  /** Unknown keys fail closed; attacker-controlled key IDs never cause extra fetches. */
  async getKey(id: string): Promise<PawaPayPublicKey> {
    const key = (await this.getKeys()).find((item) => item.id === id);
    if (!key) throw new Error('Unknown pawaPay signing key.');
    return key;
  }

  private async load(): Promise<readonly PawaPayPublicKey[]> {
    try {
      const response = await this.request('https://api.sandbox.pawapay.io/v2/public-key/http', {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${this.#token}`, Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Provider rejected key retrieval');
      const text = await response.text();
      if (text.length > 65536) throw new Error('Signing key response too large');
      const payload: unknown = JSON.parse(text);
      if (!Array.isArray(payload) || payload.length < 1 || payload.length > 32) throw new Error('Invalid public keys');
      const seen = new Set<string>();
      const keys = payload.map((item: unknown) => {
        if (!item || typeof item !== 'object') throw new Error('Invalid public key');
        const { id, key } = item as Record<string, unknown>;
        if (typeof id !== 'string' || !/^[A-Za-z0-9_:./-]{1,128}$/.test(id) || seen.has(id) ||
            typeof key !== 'string' || key.length > 8192 || !key.startsWith('-----BEGIN PUBLIC KEY-----') || !key.trimEnd().endsWith('-----END PUBLIC KEY-----')) throw new Error('Invalid public key');
        seen.add(id);
        const parsed = createPublicKey(key);
        const validRsa = parsed.asymmetricKeyType === 'rsa' && (parsed.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048;
        const validEc = parsed.asymmetricKeyType === 'ec' && ['prime256v1', 'secp384r1'].includes(parsed.asymmetricKeyDetails?.namedCurve ?? '');
        if (!validRsa && !validEc) throw new Error('Unsupported public key');
        return Object.freeze({ id, key });
      });
      this.#keys = Object.freeze(keys);
      this.#expires = this.clock() + this.#ttl;
      return this.#keys;
    } catch {
      // No stale fallback or raw response/network diagnostics containing secrets.
      throw new Error('Unable to retrieve trusted pawaPay sandbox signing keys.');
    }
  }
}
