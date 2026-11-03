import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

export const pawaPayCallbackTypes = ['checkouts', 'deposits', 'payouts', 'refunds'] as const;
type CallbackType = typeof pawaPayCallbackTypes[number];
const idFields = { checkouts: 'checkoutId', deposits: 'depositId', payouts: 'payoutId', refunds: 'refundId' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses = {
  checkouts: ['WAITING_PAYMENT', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'],
  deposits: ['PROCESSING', 'COMPLETED', 'FAILED'],
  payouts: ['PROCESSING', 'COMPLETED', 'FAILED'],
  refunds: ['PROCESSING', 'COMPLETED', 'FAILED'],
};

class ReceiverError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); }
}

// Bootstrap receipt journal only. No credentials, payment tables or entitlements.
// Callback claims are deliberately untrusted until provider verification is wired.
export class SandboxCallbackJournal {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: string, private readonly maxReceipts = 1000) {}

  async initialize() { await mkdir(this.directory, { recursive: true }); }

  receive(type: CallbackType, raw: Buffer, signatureVerified=false) {
    const operation = this.pending.then(() => this.persist(type, raw,signatureVerified));
    this.pending = operation.catch(() => undefined);
    return operation;
  }

  private async persist(type: CallbackType, raw: Buffer,signatureVerified:boolean) {
    let body: unknown;
    try { body = JSON.parse(raw.toString('utf8')); }
    catch { throw new ReceiverError(400, 'Invalid JSON.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ReceiverError(400, 'Expected a callback object.');
    const input = body as Record<string, unknown>;
    const reference = input[idFields[type]], status = input.status;
    if (typeof reference !== 'string' || !uuid.test(reference)
      || typeof status !== 'string' || !statuses[type].includes(status)) {
      throw new ReceiverError(400, 'Invalid callback reference or status.');
    }
    const receiptId = createHash('sha256').update(type).update('\0').update(raw).digest('hex');
    const destination = join(this.directory, `${receiptId}.json`);
    try {
      const existing = JSON.parse(await readFile(destination, 'utf8'));
      if (existing.receiptId !== receiptId || existing.trusted !== false) throw new Error('Invalid receipt journal.');
      return { received: true, trusted: false, duplicate: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const files = await readdir(this.directory);
    if (files.filter(file => file.endsWith('.json')).length >= this.maxReceipts) {
      throw new ReceiverError(503, 'Sandbox receipt journal is full.');
    }
    // Allowlist persisted fields: never retain wallet numbers, metadata or headers.
    const receipt = { receiptId, type, reference, status, receivedAt: new Date().toISOString(), trusted: false, signatureVerified };
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(receipt) + '\n', { flag: 'wx', mode: 0o600, flush: true });
      await rename(temporary, destination);
    } finally { await unlink(temporary).catch(() => undefined); }
    return { received: true, trusted: false, duplicate: false };
  }
}

function reply(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
    throw new ReceiverError(415, 'Use application/json.');
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) throw new ReceiverError(413, 'Callback exceeds 64 KiB.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function createPawaPaySandboxReceiver(options: {
  environment: string; sandboxEnabled: boolean; directory: string; maxReceipts?: number;
  authenticate?: (type:CallbackType,raw:Buffer,headers:IncomingMessage['headers'])=>Promise<boolean>;
}) {
  if (options.environment !== 'development' || options.sandboxEnabled !== true) {
    throw new Error('Callback bootstrap receiver is development/sandbox only.');
  }
  const journal = new SandboxCallbackJournal(options.directory, options.maxReceipts);
  await journal.initialize();
  let windowStart = Date.now(), requests = 0;
  return createServer(async (request, response) => {
    try {
      const type = pawaPayCallbackTypes.find(value => request.url === `/v1/webhooks/pawapay/${value}`);
      if (request.method === 'GET' && (type || request.url === '/health')) {
        reply(response, 200, { service: 'autoguardian-pawapay-sandbox', mode: 'receipt-only', ready: true });
        return;
      }
      if (!type) { reply(response, 404, { error: 'Not found.' }); return; }
      if (request.method !== 'POST') { reply(response, 405, { error: 'Use POST for callbacks.' }); return; }
      if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); requests = 0; }
      if (++requests > 120) { reply(response, 429, { error: 'Sandbox rate limit reached.' }); return; }
      const raw=await readBody(request);
      const signatureVerified=options.authenticate?await options.authenticate(type,raw,request.headers):false;
      if(options.authenticate&&!signatureVerified){reply(response,401,{error:'Invalid callback signature.'});return;}
      const result = await journal.receive(type, raw,signatureVerified);
      reply(response, 200, result);
    } catch (error) {
      reply(response, error instanceof ReceiverError ? error.statusCode : 503,
        { error: error instanceof ReceiverError ? error.message : 'Unable to persist sandbox receipt.' });
    }
  });
}
