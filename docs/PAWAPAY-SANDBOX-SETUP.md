# pawaPay sandbox callback setup

Prepared on 13 October 2026. Provider choice: pawaPay, sandbox first.

## Current callback values

The temporary HTTPS tunnel forwards to a dedicated callback-only receiver on
`127.0.0.1:3100`. It does not expose the main AutoGuardian API or connect to the
database. Paste these into the **sandbox** dashboard:

| Dashboard field | URL |
| --- | --- |
| Checkouts | `https://announces-mem-tied-consists.trycloudflare.com/v1/webhooks/pawapay/checkouts` |
| Deposits | `https://announces-mem-tied-consists.trycloudflare.com/v1/webhooks/pawapay/deposits` |
| Payouts | `https://announces-mem-tied-consists.trycloudflare.com/v1/webhooks/pawapay/payouts` |
| Refunds | `https://announces-mem-tied-consists.trycloudflare.com/v1/webhooks/pawapay/refunds` |

These URLs depend on this computer, the receiver and the tunnel remaining running.
Restarting a Cloudflare Quick Tunnel generates a new hostname; update all four
dashboard values when that happens. Use a stable hosted endpoint for production.

## What is implemented

- Four JSON POST callback routes and GET readiness responses.
- Local receipts written before HTTP 200 acknowledgement, with exact-request retry deduplication.
- Only operation, UUID reference, status, receipt digest, timestamp and `trusted: false` are retained.
- No wallet numbers, metadata, API tokens or request headers are saved.
- A 64 KiB body limit, 120 POST requests/minute and 1,000 unique receipt limit.
- Explicit sandbox startup; startup is rejected when `NODE_ENV` is not `development`.
- The main backend, database and production payment gates are untouched.

This is a **sandbox bootstrap receiver**, not completed payment integration.
It accepts minimally valid callback claims as unverified receipts. It does not
verify pawaPay signatures, confirm amounts/currencies, issue receipts to users,
change payment state, grant checks, activate registrations or renew subscriptions.
No raw callback is retained for later replay. Once payment integration is wired,
use fresh sandbox transactions to verify trusted payment processing.

The sandbox token is saved locally in `backend/.env`. Do not commit the token or
put it in mobile `EXPO_PUBLIC_*` variables. The new backend sandbox client reads
the token, fetches enabled DRC deposit providers, initiates deposits and retrieves
authenticated payment status. It rejects a production base URL and redirects,
does not automatically retry financial requests, and validates returned payment
details against the saved sandbox operation using exact decimal comparisons.

The callback receiver still records unverified summaries only. Signature
verification, database payment records and business-operation binding remain
required before any payment can unlock an operation. Signed callback headers may
be sent to this bootstrap receiver, but they are not yet verified.

## Provider connection and sandbox smoke test

From `backend`, after saving the sandbox token and ensuring the receiver/tunnel
are running:

```powershell
npm.cmd run build
npm.cmd run pawapay:check
npm.cmd run pawapay:test
```

`pawapay:check` verifies account configuration without printing the API token.
`pawapay:test` uses the official Vodacom DRC test wallets for success and refusal,
each for **1,000 simulated CDF**. It checks the configured public callback is
reachable, saves references before initiating, polls authenticated status,
compares amount/currency/country/payer/reference, and checks callback delivery.
No real wallet or production API is used. The test records are stored in the
Git-ignored `.tools/pawapay/smoke` directory.

Re-running resumes the same saved references rather than creating new payments.
A network timeout is an uncertain outcome: reconcile the saved reference before
retrying. These test results do not grant app entitlements or activate vehicles.

## Restart locally

From `backend`, run:

```powershell
npm.cmd run build
npm.cmd run pawapay:sandbox
```

In another terminal at the project root, run:

```powershell
.\.tools\pawapay\cloudflared.exe tunnel --url http://127.0.0.1:3100 --protocol http2 --no-autoupdate
```

Keep both running. Copy the new `https://….trycloudflare.com` origin from the tunnel
output and append each `/v1/webhooks/pawapay/...` path above. If the current receiver
is already running, restarting it will report that the port is occupied; reuse
the existing process or stop that receiver before restarting.

The initially launched background process IDs are receiver `29544` and tunnel
`31872`. Check process identity before stopping a saved PID because Windows may
reuse IDs. Logs and receipt summaries are under `.tools/pawapay/`, which is ignored
by Git. If the journal reaches capacity, new requests receive HTTP 503 rather
than a false acknowledgement; archive reviewed summaries before clearing space.

## Verification

```powershell
cd backend
npm.cmd run build
node --test tests/pawapay-sandbox.test.cjs
node --test tests/pawapay-client.test.cjs
```

The focused tests cover all routes, durable receipt summaries, duplicate
requests, privacy, malformed/wrong-operation/oversized requests, restart recovery,
capacity failure and sandbox-only startup.

Verified on 13 October 2026: backend build passed, all four focused tests passed,
and the complete backend suite passed all 84 tests. Synthetic POST requests through
each of the four public HTTPS URLs returned HTTP 200 with `trusted: false`.
Provider-delivery evidence from subsequent sandbox transactions is recorded below.

After token setup on 13 October 2026:

- Authenticated configuration request returned HTTP 200. DRC Airtel, Orange and Vodacom deposits were enabled in CDF and USD.
- The sandbox account reported `signedRequestsOnly: false` and `signedCallbacks: false`.
- Nine focused callback/client tests passed; backend build passed.
- Success reference `b139efbc-912f-4cde-8f40-d2e598264764` reached `COMPLETED`. Amount, currency, country, payer and reference matched; its provider callback arrived.
- Refusal reference `abf64caa-f051-4469-9737-8a516cab43d2` reached `FAILED` with `PAYMENT_NOT_APPROVED`. Payment details matched; its provider callback arrived.
- A transient network timeout was recovered by resuming the saved references, without generating replacement payments.

Sandbox business billing and app screens are now implemented. See
[Milestone 3 implementation and setup](MILESTONE-3-IMPLEMENTATION.md) for migrations,
separate worker credentials, encrypted payer configuration, payment recovery,
subscription state and administration. Complete app journeys against the real
provider still require acceptance; sandbox payments cannot activate production registration.

Signed callback verification is implemented and tested locally. Enable it with
`PAWAPAY_REQUIRE_SIGNED_CALLBACKS=true` only after enabling signed callbacks in the
pawaPay dashboard and configuring all four exact URLs. Restart the receiver to
load this setting. It verifies raw body digests, signatures and freshness against
authenticated sandbox public keys; payment confirmation uses a separate provider
status reconciliation. The currently running receiver is the earlier unsigned
receipt-only build, and the previously verified provider setting is unsigned.

Official references: [callback configuration](https://docs.pawapay.io/dashboard/other/system_conf/callback_urls),
[sandbox setup](https://docs.pawapay.io/v2/docs/how_to_start),
[signed callbacks](https://docs.pawapay.io/v2/docs/signatures), and
[Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

## Updated-token retest and service startup

The replacement sandbox token authenticated successfully (HTTP 200). Fresh fixed-wallet 1000 CDF transactions passed:

- Success: `2d1db9ef-f9dd-4085-a112-d038ef2fd7f1` reached `COMPLETED`; exact details matched and its callback arrived.
- Refusal: `c590ddf5-17d4-4501-8671-80a0a89acdaa` reached `FAILED`; exact details/failure reason matched and its callback arrived.
- References and results are preserved in the ignored `.tools/pawapay/retest-token-update-20261013` journal, separately from earlier smoke records.
- All 17 affected billing/client/receiver tests passed.

The API was restarted on `127.0.0.1:3000` to load sandbox billing, and the billing worker was started. Billing and administration routes returned the expected HTTP 401 without a login token; neither service reported startup errors. Process IDs and logs are in the ignored `.tools/milestone3-services` directory. Do not start duplicate workers.

The account still uses unsigned callbacks. These tests establish sandbox provider behavior and receiver delivery, not signed callback delivery, production payment activation or complete logged-in app acceptance. Administrator sandbox pricing and user journeys still need app acceptance.
