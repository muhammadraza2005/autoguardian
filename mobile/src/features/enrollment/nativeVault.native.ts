import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { AESEncryptionKey, AESSealedData, aesEncryptAsync, aesDecryptAsync, digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto';
import { createEncryptedVault } from './encryptedVault';

const keyName = 'autoguardian.enrollment.vault.v1';
// Persistent app-private ciphertext; no plaintext draft, filename or attachment
// is written here. SecureStore keeps the AES key outside this directory.
const directory = () => new Directory(Paths.document, 'enrollment-vault-v1');
function file(name: string) {
  if (!/^[a-f0-9]{64}$/.test(name)) throw new Error('Invalid encrypted filename.');
  return new File(directory(), name + '.agenc');
}
const encoder = new TextEncoder(), decoder = new TextDecoder();
export const nativeVault = createEncryptedVault({
  keyRead: () => SecureStore.getItemAsync(keyName),
  keyWrite: value => SecureStore.setItemAsync(keyName, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  keyDelete: () => SecureStore.deleteItemAsync(keyName),
  async read(name) { const saved = file(name); if (!saved.exists) return null;
    if (saved.size > 6 * 1024 * 1024) throw new Error('Encrypted file is too large.');
    return saved.text(); },
  async write(name, value) {
    await directory().create({ intermediates: true, idempotent: true });
    // Keep the last complete ciphertext until the new write has finished.
    const temporary = new File(directory(), name + '.tmp');
    await temporary.create({ overwrite: true }); await temporary.write(value);
    await temporary.move(file(name), { overwrite: true });
  },
  async remove(name) { const saved = file(name); if (saved.exists) await saved.delete(); },
  async clear() { const saved = directory(); if (saved.exists) await saved.delete(); },
}, {
  hash: value => digestStringAsync(CryptoDigestAlgorithm.SHA256, value),
  async generate() { return (await AESEncryptionKey.generate()).encoded('hex'); },
  async seal(value, key, context) {
    const sealed = await aesEncryptAsync(encoder.encode(value), await AESEncryptionKey.import(key, 'hex'),
      { nonce: { length: 12 }, tagLength: 16, additionalData: encoder.encode(context) });
    return sealed.combined('base64');
  },
  async open(value, key, context) {
    const plain = await aesDecryptAsync(AESSealedData.fromCombined(value), await AESEncryptionKey.import(key, 'hex'),
      { additionalData: encoder.encode(context) });
    return decoder.decode(plain);
  },
});
