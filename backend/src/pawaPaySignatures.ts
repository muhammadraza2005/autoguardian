import { constants, createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

export interface PawaPayCallbackSignatureInput {
  /** Exact HTTP body bytes captured before JSON parsing. */
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  /** Trusted configuration, never constructed from Host/Forwarded headers. */
  callbackUrl: string;
  /** Keys fetched from the configured pawaPay API over authenticated HTTPS. */
  publicKeys: readonly { id: string; key: string }[];
  now?: Date;
  maxAgeSeconds?: number;
  clockSkewSeconds?: number;
}

export type PawaPaySignatureResult =
  | { verified: true; keyId: string; algorithm: string; created: number; expires: number; fingerprint: string }
  | { verified: false; reason: string };

const components = ['@method', '@authority', '@path', 'signature-date', 'content-digest', 'content-type'];
const algorithms = ['rsa-pss-sha512', 'rsa-v1_5-sha256', 'ecdsa-p256-sha256', 'ecdsa-p384-sha384'];

function decodeBase64(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) || !value) {
    throw new Error('Malformed base64');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error('Noncanonical base64');
  return bytes;
}

/**
 * Strict pawaPay callback profile, not a general RFC 9421 parser.
 * https://docs.pawapay.io/v2/docs/signatures
 * One sig-pp signature, all six documented covered components, four metadata
 * parameters. Other profiles fail closed. Replay deduplication/atomic payment
 * binding belongs to the persistence layer; fingerprint identifies a receipt.
 */
export function verifyPawaPayCallbackSignature(input: PawaPayCallbackSignatureInput): PawaPaySignatureResult {
  try {
    const headers = new Map<string, string>();
    for (const [name, value] of Object.entries(input.headers)) {
      if (value === undefined) continue;
      const lower = name.toLowerCase();
      if (headers.has(lower) || typeof value !== 'string' || /[\r\n]/.test(value)) {
        throw new Error('Ambiguous HTTP headers');
      }
      headers.set(lower, value.trim());
    }
    const required = (name: string): string => {
      const value = headers.get(name);
      if (!value || value.length > 8192) throw new Error(`Missing or invalid ${name}`);
      return value;
    };
    const signatureInput = required('signature-input');
    const match = /^sig-pp=(\((?:"[@a-z-]+" ?)+\))((?:;[a-z]+=(?:"[A-Za-z0-9_:./-]+"|[0-9]+)){4})$/.exec(signatureInput);
    if (!match) throw new Error('Unsupported signature input profile');
    const covered = [...match[1].matchAll(/"([@a-z-]+)"/g)].map((item) => item[1]);
    if (covered.length !== components.length || new Set(covered).size !== components.length ||
        components.some((component) => !covered.includes(component))) throw new Error('Incomplete signature coverage');
    // Require a canonical component list: no concatenated strings or extra whitespace.
    if (match[1] !== `(${covered.map((item) => `"${item}"`).join(' ')})`) throw new Error('Malformed component list');
    const metadata = new Map<string, string>();
    for (const parameter of match[2].matchAll(/;([a-z]+)=("[A-Za-z0-9_:./-]+"|[0-9]+)/g)) {
      if (metadata.has(parameter[1])) throw new Error('Duplicate signature metadata');
      metadata.set(parameter[1], parameter[2]);
    }
    if (['alg', 'keyid', 'created', 'expires'].some((name) => !metadata.has(name))) throw new Error('Missing signature metadata');
    const algorithmValue = metadata.get('alg')!;
    const keyIdValue = metadata.get('keyid')!;
    if (!algorithmValue.startsWith('"') || !keyIdValue.startsWith('"')) throw new Error('Invalid signature identifiers');
    const algorithm = algorithmValue.slice(1, -1);
    const keyId = keyIdValue.slice(1, -1);
    if (!algorithms.includes(algorithm)) throw new Error('Unsupported signature algorithm');
    if (!/^[0-9]+$/.test(metadata.get('created')!) || !/^[0-9]+$/.test(metadata.get('expires')!)) throw new Error('Invalid signature timestamps');
    const created = Number(metadata.get('created'));
    const expires = Number(metadata.get('expires'));
    const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
    const maxAge = input.maxAgeSeconds ?? 300;
    const skew = input.clockSkewSeconds ?? 30;
    if (![created, expires, now, maxAge, skew].every(Number.isSafeInteger) || maxAge <= 0 || maxAge > 3600 || skew < 0 || skew > 300 ||
        created > now + skew || now - created > maxAge + skew || expires < now - skew || expires <= created || expires - created > maxAge) {
      throw new Error('Signature outside allowed time window');
    }
    const date = required('signature-date');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(date) ||
        Math.floor(Date.parse(date) / 1000) !== created) throw new Error('Signature date does not match creation');
    const type = required('content-type');
    if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(type)) throw new Error('Unsupported callback content type');
    const digestHeader = required('content-digest');
    const digestMatch = /^(sha-256|sha-512)=:([A-Za-z0-9+/=]+):$/.exec(digestHeader);
    if (!digestMatch) throw new Error('Unsupported content digest');
    const suppliedDigest = decodeBase64(digestMatch[2]);
    const expectedDigest = createHash(digestMatch[1].replace('-', '')).update(input.rawBody).digest();
    if (suppliedDigest.length !== expectedDigest.length || !timingSafeEqual(suppliedDigest, expectedDigest)) throw new Error('Callback body digest mismatch');
    const url = new URL(input.callbackUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid configured callback URL');
    const values: Record<string, string> = {
      '@method': 'POST', '@authority': url.host, '@path': url.pathname,
      'signature-date': date, 'content-digest': digestHeader, 'content-type': type,
    };
    const base = `${covered.map((component) => `"${component}": ${values[component]}`).join('\n')}\n"@signature-params": ${signatureInput.slice(7)}`;
    const signatureMatch = /^sig-pp=:([A-Za-z0-9+/=]+):$/.exec(required('signature'));
    if (!signatureMatch) throw new Error('Unsupported signature header');
    const signature = decodeBase64(signatureMatch[1]);
    const keys = input.publicKeys.filter((key) => key.id === keyId);
    if (keys.length !== 1) throw new Error('Unknown or ambiguous signing key');
    const publicKey = createPublicKey(keys[0].key);
    let valid: boolean;
    if (algorithm.startsWith('rsa-')) {
      if (publicKey.asymmetricKeyType !== 'rsa' || (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error('Incompatible RSA signing key');
      const pss = algorithm === 'rsa-pss-sha512';
      valid = verify(pss ? 'sha512' : 'sha256', Buffer.from(base), {
        key: publicKey, padding: pss ? constants.RSA_PKCS1_PSS_PADDING : constants.RSA_PKCS1_PADDING,
        ...(pss ? { saltLength: 64 } : {}),
      }, signature);
    } else {
      const p256 = algorithm === 'ecdsa-p256-sha256';
      if (publicKey.asymmetricKeyType !== 'ec' || publicKey.asymmetricKeyDetails?.namedCurve !== (p256 ? 'prime256v1' : 'secp384r1')) throw new Error('Incompatible EC signing key');
      // RFC 9421 uses fixed-width P1363; pawaPay's documented samples use DER.
      valid = verify(p256 ? 'sha256' : 'sha384', Buffer.from(base), {
        key: publicKey, dsaEncoding: signature.length === (p256 ? 64 : 96) ? 'ieee-p1363' : 'der',
      }, signature);
    }
    if (!valid) throw new Error('Invalid callback signature');
    return { verified: true, keyId, algorithm, created, expires,
      fingerprint: createHash('sha256').update(base).update(signature).digest('hex') };
  } catch (error) {
    return { verified: false, reason: error instanceof Error ? error.message : 'Invalid callback signature' };
  }
}
