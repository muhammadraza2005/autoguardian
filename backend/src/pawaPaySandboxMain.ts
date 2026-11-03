import { resolve } from 'node:path';
import { createPawaPaySandboxReceiver } from './pawaPaySandbox';
import {PawaPaySandboxPublicKeys} from './pawaPayPublicKeys';
import {verifyPawaPayCallbackSignature} from './pawaPaySignatures';
import {pawaPaySandboxConfiguration} from './pawaPayClient';

async function main() {
  const port = Number(process.env.PAWAPAY_SANDBOX_PORT ?? 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PAWAPAY_SANDBOX_PORT.');
  const signed=process.env.PAWAPAY_REQUIRE_SIGNED_CALLBACKS==='true';
  const keys=signed?new PawaPaySandboxPublicKeys(pawaPaySandboxConfiguration(process.env)):undefined;
  const urls={checkouts:process.env.PAWAPAY_CHECKOUT_CALLBACK_URL,deposits:process.env.PAWAPAY_DEPOSIT_CALLBACK_URL,
    payouts:process.env.PAWAPAY_PAYOUT_CALLBACK_URL,refunds:process.env.PAWAPAY_REFUND_CALLBACK_URL};
  if(signed)for(const [type,value] of Object.entries(urls)){
    const url=new URL(value??'');if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/v1/webhooks/pawapay/'+type)
      throw new Error('Configure exact HTTPS callback URLs before requiring signatures.');
  }
  const server = await createPawaPaySandboxReceiver({
    environment: process.env.NODE_ENV ?? 'development',
    sandboxEnabled: process.argv.includes('--sandbox'),
    directory: resolve(__dirname, '../../.tools/pawapay/receipts'),
    ...(keys?{authenticate:async(type:'checkouts'|'deposits'|'payouts'|'refunds',raw:Buffer,headers:Record<string,string|string[]|undefined>)=>
      verifyPawaPayCallbackSignature({rawBody:raw,headers,callbackUrl:urls[type]!,publicKeys:await keys.getKeys()}).verified}:{}),
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on('error', () => { console.error('Unable to start sandbox receiver; check whether the port is occupied.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`pawaPay sandbox receipt-only receiver listening on 127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close());
}
void main().catch(() => { console.error('Unable to initialize the sandbox-only callback receiver.'); process.exitCode = 1; });
