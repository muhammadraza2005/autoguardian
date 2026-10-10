// Platform-independent encrypted record store. IO and cryptography are injected
// so security and interruption behavior can be exercised with real AES-GCM tests.
export interface VaultIO {
  keyRead(): Promise<string | null>;
  keyWrite(value: string): Promise<void>;
  keyDelete(): Promise<void>;
  read(name: string): Promise<string | null>;
  write(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
  clear(): Promise<void>;
}
export interface VaultCrypto {
  hash(value: string): Promise<string>;
  generate(): Promise<string>;
  seal(value: string, key: string, context: string): Promise<string>;
  open(value: string, key: string, context: string): Promise<string>;
}
const maximum = 3 * 1024 * 1024;
export function createEncryptedVault(io: VaultIO, crypto: VaultCrypto) {
  let epoch = 0, scope: string | null = null, secret: string | null = null, fingerprint: string | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  function queue<T>(run: () => Promise<T>): Promise<T> {
    const result = tail.then(run); tail = result.catch(() => {}); return result;
  }
  function check(generation: number) {
    if (generation !== epoch || !scope || !secret || !fingerprint) throw new Error('Encrypted store is locked.');
    return { key: secret, identity: fingerprint };
  }
  async function record(id: string, generation: number) {
    if (!id || id.length > 512) throw new Error('Invalid encrypted record.');
    const active = check(generation);
    const name = await crypto.hash(id); check(generation);
    return { ...active, name, context: JSON.stringify(['AGNV1', active.identity, id]) };
  }
  return {
    identify(next: string) {
      if (!next || next.length > 4096) return Promise.reject(new Error('Invalid encrypted scope.'));
      if (next === scope && secret) return queue(async () => {});
      const generation = ++epoch; scope = next; secret = null; fingerprint = null;
      return queue(async () => {
        const identity = await crypto.hash(next);
        if (generation !== epoch) throw new Error('Encrypted scope changed.');
        const stored = await io.keyRead();
        let previous: { identity?: unknown; key?: unknown } = {};
        try { previous = JSON.parse(stored ?? '{}'); } catch { /* Invalid keys cannot recover files. */ }
        let key: string;
        if (previous?.identity === identity && typeof previous.key === 'string' && /^[a-f0-9]{64}$/.test(previous.key)) {
          key = previous.key;
        } else {
          // Erase the old key first: remaining ciphertext is unusable if cleanup fails.
          await io.keyDelete(); await io.clear(); key = await crypto.generate();
          if (generation !== epoch) throw new Error('Encrypted scope changed.');
          await io.keyWrite(JSON.stringify({ identity, key }));
        }
        if (generation !== epoch) throw new Error('Encrypted scope changed.');
        secret = key; fingerprint = identity;
      });
    },
    read(id: string) {
      const generation = epoch;
      return queue(async () => {
        const active = await record(id, generation), encrypted = await io.read(active.name);
        check(generation);
        if (encrypted === null) return null;
        if (encrypted.length > maximum * 2) throw new Error('Encrypted record is too large.');
        const plain = await crypto.open(encrypted, active.key, active.context); check(generation);
        if (plain.length > maximum) throw new Error('Encrypted record is too large.');
        return plain;
      });
    },
    write(id: string, value: string) {
      const generation = epoch;
      return queue(async () => {
        if (value.length > maximum) throw new Error('Encrypted record is too large.');
        const active = await record(id, generation);
        const encrypted = await crypto.seal(value, active.key, active.context); check(generation);
        await io.write(active.name, encrypted); check(generation);
      });
    },
    remove(id: string) {
      const generation = epoch;
      return queue(async () => { const active = await record(id, generation); await io.remove(active.name); check(generation); });
    },
    clear() {
      ++epoch; scope = null; secret = null; fingerprint = null;
      return queue(async () => { await io.keyDelete(); await io.clear(); });
    },
  };
}
