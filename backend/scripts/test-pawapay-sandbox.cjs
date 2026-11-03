const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PawaPaySandboxClient, pawaPaySandboxConfiguration, confirmSandboxDeposit, sandboxAmountUnits } = require('../dist/pawaPayClient');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const client = new PawaPaySandboxClient(pawaPaySandboxConfiguration(process.env));
  const config = await client.activeConfiguration();
  const provider = config.countries.find(country => country.country === 'COD')?.providers?.find(provider => provider.provider === 'VODACOM_MPESA_COD');
  const depositConfig = provider?.currencies?.find(currency => currency.currency === 'CDF')?.operationTypes?.DEPOSIT;
  if (!depositConfig || depositConfig.status !== 'OPERATIONAL') throw new Error('Vodacom CDF sandbox deposits are unavailable.');
  if (sandboxAmountUnits('1000') < sandboxAmountUnits(depositConfig.minAmount)
    || sandboxAmountUnits('1000') > sandboxAmountUnits(depositConfig.maxAmount)) throw new Error('Test amount is outside the configured deposit limits.');
  if (config.signatureConfiguration?.signedRequestsOnly) throw new Error('Account requires signed requests; configure request signing first.');
  const callback = process.env.PAWAPAY_DEPOSIT_CALLBACK_URL;
  if (!callback || depositConfig.callbackUrl !== callback) throw new Error('Dashboard deposit callback does not match the configured URL.');
  const readiness = await fetch(callback, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  const health = await readiness.json();
  if (!readiness.ok || health.service !== 'autoguardian-pawapay-sandbox') throw new Error('Callback receiver is unavailable.');
  const directory = path.resolve(__dirname, '../../.tools/pawapay/smoke');
  await fs.mkdir(directory, { recursive: true });
  // Official pawaPay test wallets only. No real wallets or production API.
  for (const scenario of [
    { name: 'success', phoneNumber: '243813456789', expectedStatus: 'COMPLETED' },
    { name: 'refused', phoneNumber: '243813456039', expectedStatus: 'FAILED', failureCode: 'PAYMENT_NOT_APPROVED' },
  ]) {
    const file = path.join(directory, `${scenario.name}.json`);
    let record;
    try { record = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      record = { deposit: { depositId: randomUUID(), amount: '1000', currency: 'CDF', payer: { type: 'MMO', accountDetails: { provider: 'VODACOM_MPESA_COD', phoneNumber: scenario.phoneNumber } } } };
      // Save the reference BEFORE the financial request. Re-running resumes it.
      await fs.writeFile(file, JSON.stringify(record), { flag: 'wx', mode: 0o600, flush: true });
    }
    if (record.deposit?.amount !== '1000' || record.deposit?.currency !== 'CDF'
      || record.deposit?.payer?.type !== 'MMO'
      || record.deposit?.payer?.accountDetails?.provider !== 'VODACOM_MPESA_COD'
      || record.deposit?.payer?.accountDetails?.phoneNumber !== scenario.phoneNumber) {
      throw new Error('Saved smoke record differs from the fixed sandbox-only test scenario.');
    }
    let status = await client.depositStatus(record.deposit.depositId);
    if (!status) {
      const initiation = await client.initiateDeposit(record.deposit);
      console.log(`${scenario.name}: initiation ${initiation.status}, reference ${initiation.depositId}`);
      if (initiation.status === 'REJECTED') throw new Error('Sandbox deposit rejected at initiation.');
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      status = await client.depositStatus(record.deposit.depositId);
      if (status && ['COMPLETED', 'FAILED'].includes(status.status)) break;
      await pause(2000);
    }
    if (!status || status.status !== scenario.expectedStatus) throw new Error('Sandbox final status did not match the scenario.');
    const completed = confirmSandboxDeposit(record.deposit, status);
    if (completed !== (scenario.expectedStatus === 'COMPLETED')) throw new Error('Invalid payment confirmation.');
    if (scenario.failureCode && status.failureReason?.failureCode !== scenario.failureCode) throw new Error('Unexpected failure reason.');
    let callbackReceived = false;
    const receiptDirectory = path.resolve(directory, '../receipts');
    for (let attempt = 0; attempt < 15 && !callbackReceived; attempt++) {
      for (const name of await fs.readdir(receiptDirectory)) {
        if (!name.endsWith('.json')) continue;
        const receipt = JSON.parse(await fs.readFile(path.join(receiptDirectory, name), 'utf8'));
        if (receipt.type === 'deposits' && receipt.reference === record.deposit.depositId && receipt.status === scenario.expectedStatus) callbackReceived = true;
      }
      if (!callbackReceived) await pause(2000);
    }
    const result = { status: status.status, confirmedByAuthenticatedApi: true, callbackReceived, testedAt: new Date().toISOString() };
    const temporary = file + '.tmp';
    await fs.writeFile(temporary, JSON.stringify({ ...record, result }), { mode: 0o600, flush: true });
    await fs.rename(temporary, file);
    console.log(`${scenario.name}: final ${status.status}; payment details matched; provider callback ${callbackReceived ? 'received' : 'not yet received'}`);
    if (!callbackReceived) throw new Error('Provider callback delivery has not been confirmed.');
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Sandbox test failed.'); process.exitCode = 1; });
