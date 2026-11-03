# Milestone 3 — next implementation phase

Items 4–8 now have additional local implementation. This is not production, SMS delivery or Android acceptance. No live payment, SMS or hosted migration was executed during this phase.

## Installation order

The user reported successful hosted checks for migrations 024/025 and the worker setup; the worker login and restricted permissions were also checked previously. Preserve those installed migrations.

1. Run [migration 026](../supabase/migrations/202610130026_billing_operations.sql) once, as the database migration administrator, after 025.
2. Run [the read-only verifier](../supabase/verify-billing-operations.sql). Every result should be `true`. These checks establish installation and permissions, not provider acceptance.
3. Build the backend with `npm.cmd run build` in `backend`. Restart the API and billing worker to use the new code. Existing running processes continue using their previous binaries until restarted.
4. In the app, sign in with a current tenant administrator and recent password/TOTP proof. Open **Billing and offline policies**. Prices are still stored in the existing billing configuration. Supply an approval reference and the exact price revision; changing prices requires renewed policy approval before new live charges.
5. Enter approved receipt identity, receipt validity, subscription grace access and SMS copy. Leave production, SMS and offline access disabled until the associated rules are approved. No default prices, merchant details or policy approval were manufactured.

## Production registration payments

`/v1/billing/live` is registered only when the live provider configuration is enabled. Registration uses the current production enrollment snapshot. Payer information is encrypted using a separate key; live records, subscriptions, reminders and receipts occupy separate tables from sandbox records.

The worker queries the saved provider deposit reference before initiation. Unknown outcomes remain pending and mismatched money/wallet/provider data cannot confirm a payment. Completed registration payments issue `PAYMENT` prerequisite receipts only when draft, owner generation, fitting and snapshot revisions still match. Stale payments remain in payment history and are audited; they do not authorize edited registrations. Other registration prerequisites remain mandatory.

The production form, history, receipt and renewal screens have separate response schemas. Sandbox receipts cannot pass the live schema. Live wallet numbers are entered by the payer; no test wallet is substituted.

Server-only configuration, after onboarding and acceptance:

```dotenv
PAWAPAY_PRODUCTION_ENABLED=false
PAWAPAY_PRODUCTION_APPROVED=false
PAWAPAY_LIVE_BASE_URL=https://api.pawapay.io
PAWAPAY_LIVE_API_TOKEN=
PAWAPAY_LIVE_BILLING_KEY_HEX=
BILLING_REMINDER_SMS_ENABLED=false
BILLING_REMINDER_SMS_APPROVED=false
```

The live token and encryption key must differ from their sandbox counterparts. Do not replace the existing sandbox encryption key: pending sandbox jobs depend on it. Keep credentials outside Git and mobile public configuration. Production enabled operators, signed-request requirements and real success/refusal/unknown-outcome acceptance still require the merchant account. Outgoing signed API requests are not implemented in this phase; accounts requiring them cannot be activated with this adapter.

Provider API reference: [going live](https://docs.pawapay.io/v2/docs/going_live), [deposit initiation](https://docs.pawapay.io/v2/api-reference/deposits/initiate-deposit).

## Subscription access and suspension

Live renewals extend the purchasing owner's subscription once, retain approved timing snapshots, and restore its `ACTIVE` state. The worker schedules reminders and derives `GRACE` and `SUSPENDED` states from server time. Former owners cannot read subscription state or obtain access.

`GET /v1/billing/operations/entitlements/:vehicleId?feature=institutional_lock` supplies the ownership-scoped access decision under the approved policy. Institutional locks are the protected feature described in `backend.md`; the institutional lock execution workflow is not implemented in this repository, so its future writer must enforce this decision in its own transaction. This endpoint alone does not complete all subscription-benefit enforcement. No additional benefit or restriction was invented. Vehicle record status and owner resale alerts are unaffected by subscription suspension.

## SMS reminders

The worker can dispatch the durable billing reminder outbox when both server opt-in and tenant policy allow it. It reuses the existing Twilio sender and limits recipients to the configured, verified phone allowlist. It selects approved English/French text according to the recipient's language and excludes acknowledged reminders and former owners.

A provider timeout or expired send lease becomes `UNKNOWN`; it is never automatically resent. Successful provider acceptance is recorded as `SUBMITTED`, not as handset delivery. This phase does not implement billing SMS delivery callbacks, delivery receipts, broader recipient rollout or automatic operator retry policy. Those require approved operational rules and delivery acceptance. No real SMS was sent.

## Statements and receipts

The administrator screen imports normalized statement deposit rows using a source reference. Each row contains `depositId`, decimal-string `amount`, `currency`, `status` and `providerReference`. Up to 1,000 distinct rows are allowed; exact retries return the original result and changed reuse of a source reference is rejected.

The importer identifies unknown payments, amount/currency differences, status differences and provider-reference differences. Imports and differences are audited. Imported rows cannot mark a payment as completed. Payment receipts snapshot approved merchant identity at purchase, so later identity edits cannot rewrite earlier receipts.

This implements transaction-statement matching. Downloading pawaPay exports automatically, adapting the actual export format, settlement fees/net totals/bank-transfer reconciliation, discrepancy resolution and approved fiscal receipt formatting remain pending. The provider [statement API](https://docs.pawapay.io/v2/api-reference/finances/initiate-statement) is asynchronous; a settlement export sample and account access are needed before connecting that format.

## Cold offline recovery

Offline recovery is disabled until a tenant administrator approves a read-only window. The server requires current MFA and accreditation before issuing a lease, bounded to at most 72 hours. That ceiling is a validation limit, not a chosen pilot duration. The lease is bound to tenant, actor, Auth user, Auth session and accredited organizations.

Native devices cache the server-approved lease/profile in a separate AES-GCM encrypted vault. Confirmed offline startup may open saved working-copy summaries within the lease window. It grants no app sections or backend permissions, permits no editing/submission/payment confirmation, and requires online verification to resume work. Web does not cache offline authorization. Expiry, detected clock rollback, account/session changes, malformed records and ciphertext tampering deny recovery. Logout clears the cache. Reconnection revalidates live profile and permissions.

The offline window bounds delayed revocation while disconnected; immediate remote revocation cannot be observed offline. Restoring an older complete encrypted application backup or device compromise is outside these automated checks. Offline editing, lost-device/retention policy, attachment viewing and actual Android interruption/background/expiry acceptance remain pending. The current policy screen labels this capability explicitly as read-only recovery.

## Verification

Tests exercise the actual migrated PostgreSQL engine and real AES-GCM storage. Provider/SMS calls use test doubles at the external network boundary; they do not establish live provider or handset acceptance.

- Backend: `npm.cmd test` — build and 125 tests passed. The focused operations tests also run the new read-only SQL verifier.
- Mobile: `npm.cmd test` — 92 tests passed; `npm.cmd run typecheck` and `npm.cmd run lint` passed.
- `npm.cmd run check:dependencies` — compatible with the installed Expo SDK.
- `npm.cmd run export:web` and `npm.cmd run export:android` — passed. Android required permission to launch the installed local Hermes compiler after the initial sandbox execution was denied.

Export success verifies bundling, not a physical Android acceptance journey.
