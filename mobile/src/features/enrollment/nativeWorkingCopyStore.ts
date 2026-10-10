import { createWorkingCopyStore, type DraftWorking, type SealWorking } from './workingCopyStore.ts';
import type { createEncryptedVault } from './encryptedVault.ts';

export function createNativeWorkingCopies(vault: ReturnType<typeof createEncryptedVault>) {
  const memory = new Map<string, string>();
  const store = createWorkingCopyStore({ getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => { memory.set(key, value); }, removeItem: key => { memory.delete(key); } });
  let scope: string | null = null, epoch = 0, writeRevision = 0, error: unknown = null;
  let pending: Promise<void> = Promise.resolve();
  let state: 'ready' | 'saving' | 'failed' = 'ready';
  const listeners = new Set<() => void>();
  const notify = (next: typeof state) => { state = next; for (const listener of listeners) listener(); };
  function persist() {
    if (!scope) return;
    const generation = epoch, revision = ++writeRevision, snapshot = JSON.stringify([...memory]);
    notify('saving');
    pending = vault.write('working-copies', snapshot).then(() => {
      if (generation === epoch && revision === writeRevision) { error = null; notify('ready'); }
    }, failure => { if (generation === epoch && revision === writeRevision) { error = failure; notify('failed'); } });
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getStatus: () => state,
    async prepare(next: string) {
      if (scope === next) { await pending; if (error) throw error; return; }
      const generation = ++epoch; scope = null; memory.clear(); error = null; notify('saving');
      try {
        await vault.identify(next);
        const raw = await vault.read('working-copies');
        if (generation !== epoch) throw new Error('Account changed.');
        if (raw) {
          const values: unknown = JSON.parse(raw);
          if (!Array.isArray(values) || values.length > 102 || values.some(value => !Array.isArray(value) || value.length !== 2
            || typeof value[0] !== 'string' || !value[0].startsWith('autoguardian:working:v1:')
            || typeof value[1] !== 'string' || value[1].length > 20000)) throw new Error('Invalid encrypted recovery.');
          for (const [key, value] of values) memory.set(key, value);
        }
        store.identify(next); scope = next; notify('ready');
      } catch (failure) { if (generation === epoch) { memory.clear(); error = failure; notify('failed'); } throw failure; }
    },
    identify(next: string) { if (scope !== next) throw new Error('Encrypted storage is not prepared.'); },
    read: store.read,
    write(next: string, id: string, value: DraftWorking | SealWorking) { if (scope !== next) return; store.write(next, id, value); persist(); },
    remove(next: string, kind: 'vehicle' | 'seals', id: string) { if (scope !== next) return; store.remove(next, kind, id); persist(); },
    clear() {
      const generation = ++epoch; scope = null; memory.clear(); error = null; notify('saving');
      pending = vault.clear().then(() => { if (generation === epoch) notify('ready'); },
        failure => { if (generation === epoch) { error = failure; notify('failed'); } });
      return pending.then(() => { if (error) throw error; });
    },
    async flush() { await pending; if (error) throw error; },
  };
}
