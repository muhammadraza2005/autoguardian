// Never display the token, full provider configuration or customer information.
async function main() {
  if (process.env.PAWAPAY_BASE_URL !== 'https://api.sandbox.pawapay.io') throw new Error('Expected the sandbox API URL.');
  const token = process.env.PAWAPAY_API_TOKEN?.trim();
  if (!token) throw new Error('Sandbox token is missing.');
  const response = await fetch('https://api.sandbox.pawapay.io/v2/active-conf?country=COD&operationType=DEPOSIT', {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  console.log('Sandbox authentication HTTP status:', response.status);
  if (!response.ok) throw new Error('Sandbox configuration request was rejected.');
  const config = await response.json();
  console.log('Signature configuration:', JSON.stringify(config.signatureConfiguration));
  for (const country of config.countries ?? []) {
    console.log('Enabled country:', country.country);
    for (const provider of country.providers ?? []) {
      console.log('Enabled provider:', provider.provider);
      for (const currency of provider.currencies ?? []) {
        const deposit = currency.operationTypes?.DEPOSIT;
        console.log('Currency:', currency.currency, 'Deposit configuration:', JSON.stringify(deposit && {
          minAmount: deposit.minAmount, maxAmount: deposit.maxAmount, status: deposit.status,
          callbackUrl: deposit.callbackUrl,
        }));
      }
    }
  }
}
main().catch(() => { console.error('Sandbox check failed; check connectivity, token and account permissions. No secret values were displayed.'); process.exitCode = 1; });
