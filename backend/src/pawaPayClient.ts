import { inspect } from 'node:util';

const sandboxBaseUrl = 'https://api.sandbox.pawapay.io';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface SandboxDeposit {
  depositId: string; amount: string; currency: 'CDF' | 'USD';
  payer: { type: 'MMO'; accountDetails: { phoneNumber: string; provider: string } };
}
export function pawaPaySandboxConfiguration(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV && env.NODE_ENV !== 'development') throw new Error('pawaPay sandbox client is development only.');
  if (env.PAWAPAY_BASE_URL !== sandboxBaseUrl) throw new Error('pawaPay sandbox URL required.');
  const token = env.PAWAPAY_API_TOKEN?.trim();
  if (!token || /\s/.test(token)) throw new Error('A valid sandbox token is required.');
  return { token };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid pawaPay response.');
  return value as Record<string, unknown>;
}

// Fixed sandbox origin and no redirects: never forward credentials to another host.
// No retries on financial POSTs. Persist depositId before initiation and reconcile
// ambiguous failures with GET before deciding whether to resend the same operation.
export class PawaPaySandboxClient {
  readonly #token: string;
  constructor(configuration: { token: string }, private readonly request: typeof fetch = fetch,
    private readonly environment:'SANDBOX'|'PRODUCTION'='SANDBOX') {
    if (!configuration.token || /\s/.test(configuration.token)) throw new Error('A valid sandbox token is required.');
    this.#token = configuration.token;
  }
  [inspect.custom]() { return `PawaPayClient { environment: ${this.environment}, token: [REDACTED] }`; }

  private async call(path: string, body?: SandboxDeposit) {
    let response: Response;
    try {
      response = await this.request((this.environment==='PRODUCTION'?'https://api.pawapay.io':sandboxBaseUrl) + '/v2/' + path, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${this.#token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch { throw new Error('pawaPay sandbox request failed; reconcile the saved reference before retrying.'); }
    if (!response.ok) throw new Error(`pawaPay sandbox request rejected (HTTP ${response.status}).`);
    try { return object(await response.json()); }
    catch { throw new Error('Invalid pawaPay sandbox JSON response.'); }
  }

  async activeConfiguration() {
    const result = await this.call('active-conf?country=COD&operationType=DEPOSIT');
    if (!Array.isArray(result.countries)) throw new Error('Invalid pawaPay configuration.');
    return result;
  }

  async initiateDeposit(deposit: SandboxDeposit) {
    if (!uuid.test(deposit.depositId) || !/^[1-9][0-9]{0,17}(?:\.[0-9]{1,4})?$|^0\.[0-9]{1,4}$/.test(deposit.amount)
      || !['CDF', 'USD'].includes(deposit.currency) || deposit.payer?.type !== 'MMO'
      || !/^243[0-9]{9}$/.test(deposit.payer?.accountDetails?.phoneNumber ?? '')
      || !['AIRTEL_COD', 'ORANGE_COD', 'VODACOM_MPESA_COD'].includes(deposit.payer?.accountDetails?.provider)) {
      throw new Error('Invalid DRC sandbox deposit.');
    }
    const result = await this.call('deposits', deposit);
    if (result.depositId !== deposit.depositId || !['ACCEPTED', 'REJECTED', 'DUPLICATE_IGNORED'].includes(String(result.status))) {
      throw new Error('Invalid pawaPay initiation response.');
    }
    return { depositId: deposit.depositId, status: String(result.status) };
  }

  async depositStatus(depositId: string) {
    if (!uuid.test(depositId)) throw new Error('Invalid deposit reference.');
    const result = await this.call(`deposits/${depositId}`);
    if (result.status === 'NOT_FOUND') return undefined;
    const data = object(result.data);
    if (result.status !== 'FOUND' || data.depositId !== depositId
      || !['ACCEPTED', 'SUBMITTED', 'PROCESSING', 'COMPLETED', 'FAILED'].includes(String(data.status))) {
      throw new Error('Invalid pawaPay deposit status response.');
    }
    return data;
  }
}

export class PawaPayProductionClient extends PawaPaySandboxClient {
  constructor(configuration:{token:string},request:typeof fetch=fetch){super(configuration,request,'PRODUCTION');}
}
export function pawaPayProductionConfiguration(env:NodeJS.ProcessEnv){
  if(env.PAWAPAY_PRODUCTION_ENABLED!=='true')return undefined;
  if(env.PAWAPAY_LIVE_BASE_URL!=='https://api.pawapay.io'||env.PAWAPAY_PRODUCTION_APPROVED!=='true')
    throw new Error('Production pawaPay requires the production origin and explicit approval.');
  const token=env.PAWAPAY_LIVE_API_TOKEN?.trim();
  if(!token||/\s/.test(token)||token===env.PAWAPAY_API_TOKEN?.trim())throw new Error('A separate live pawaPay token is required.');
  return {token};
}

// Exact decimal comparison without floating-point money calculations.
export function sandboxAmountUnits(value: unknown): bigint {
  if (typeof value !== 'string' || !/^[0-9]{1,18}(?:\.[0-9]{1,4})?$/.test(value)) throw new Error('Invalid amount.');
  const [whole, fractional = ''] = value.split('.');
  return BigInt(whole) * 10000n + BigInt(fractional.padEnd(4, '0'));
}

export function confirmSandboxDeposit(expected: SandboxDeposit, data: Record<string, unknown>) {
  const payer = object(data.payer), account = object(payer.accountDetails);
  if (data.depositId !== expected.depositId || sandboxAmountUnits(data.amount) !== sandboxAmountUnits(expected.amount)
    || data.currency !== expected.currency || data.country !== 'COD' || payer.type !== 'MMO'
    || account.provider !== expected.payer.accountDetails.provider
    || account.phoneNumber !== expected.payer.accountDetails.phoneNumber) {
    throw new Error('pawaPay payment details do not match the saved sandbox operation.');
  }
  return data.status === 'COMPLETED';
}
