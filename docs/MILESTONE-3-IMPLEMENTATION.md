# Milestone 3 implementation and setup

Implemented locally on 13 October 2026. This is **sandbox billing and pilot administration**, not a production launch or full milestone acceptance.

For the subsequent production payment, subscription policy, SMS, statement-import and cold offline recovery work, see [the next-phase guide](MILESTONE-3-NEXT-PHASE.md). It adds migration 026; the original setup below describes migrations 024/025.

## Available workflows

- Registration, check and renewal payments share durable database records, encrypted payer details, immutable price/revision snapshots and exact retries. A lost creation response reuses an existing operation instead of creating a second charge.
- A dedicated worker reconciles the saved deposit ID through pawaPay before initiating or retrying. It checks amount, currency, country, operator and wallet. Unknown outcomes remain pending; mismatches require administrative review. Bounded leases and backoff survive restarts.
- Paid checks and monthly free allowances are enforced by the database in the same transaction as check creation. Free allowances are shared across accounts with the same verified phone and use the Kinshasa calendar month. Failed lookups do not consume an allowance. Existing sample checks retain their previous behavior until sandbox billing is explicitly enabled.
- Sandbox subscriptions extend once per payment, support active/grace/suspended states, recover on renewal and generate in-app reminders. Former owners cannot read subscription details or reminders. These states do not change vehicle ownership, stop resale alerts or apply unapproved production restrictions.
- The app has English/French payment forms, history, selectable sandbox receipts, renewals, billing settings and an administrator reconciliation queue. Registration payments are bound to the draft snapshot; **sandbox payments never satisfy production registration prerequisites**.
- Signed callback verification supports the documented pawaPay HTTP signature profile, exact raw-body digests, expiry and authenticated sandbox public keys. All four receiver routes can require signatures. Callback summaries remain separate from business payment confirmation, which uses provider API reconciliation.
- Pilot administrators can manage existing organizations and agent accreditations, allocate seals, record physical count discrepancies and edit versioned incident policy/contact configuration. Existing enrollment-review and incident queues are linked. Changes require independent tenant-admin MFA and are audited. See [administration guide](PILOT-ADMINISTRATION.md).
- Native encrypted recovery automatically retries submitted vehicle/seal changes, document uploads, owner details/consent, evidence reviews and submission/finalization journals. Original bodies and keys are retained. Conflicts and denials remain for review. Work stops on account changes, backgrounding or open editors; successful work refreshes enrollment/stock caches.

## Local and hosted setup

The new migrations have been exercised in test databases, including the existing non-superuser migration test. They have **not been installed on hosted Supabase** by this change.

1. Back up the target database and apply migrations **024, then 025**, after the existing 023. Use the migration owner, not an app login. Run [verify-milestone3.sql](../supabase/verify-milestone3.sql); every result should be true.
2. Run [setup-billing-worker.sql](../supabase/setup-billing-worker.sql) once, with a separate random password supplied locally. The worker login deliberately has no table-writing privileges and cannot be the HTTP API login. Never commit passwords or connection URLs.
3. In `backend/.env`, keep `NODE_ENV=development` and the saved sandbox token/base URL. Set `PILOT_BILLING_SANDBOX_ENABLED=true`; generate an independent 32-byte random key as `PILOT_BILLING_KEY_HEX` and set `BILLING_DATABASE_URL` to the restricted worker connection. Preserve/back up that encryption key separately; changing it makes pending payer records unreadable. No real credentials or approved prices are added to committed examples.
4. Build the backend, start the API and run `npm.cmd run billing:worker` from a separate terminal. Configuration is opt-in: an MFA tenant administrator must enter sandbox rules in **Account → Payments and subscriptions → Sandbox billing settings**. No business prices, exemptions or production policies are inferred.
5. Use pawaPay's official sandbox test wallets. Test success and refusal before using the app forms. The earlier actual provider success/refusal references and callback-delivery evidence are in [sandbox setup](PAWAPAY-SANDBOX-SETUP.md).
6. To require callback signatures, enable signed callbacks in the pawaPay sandbox dashboard, configure all four exact HTTPS callback URLs, set `PAWAPAY_REQUIRE_SIGNED_CALLBACKS=true`, then restart the receiver with `npm.cmd run pawapay:sandbox`. The public tunnel hostname must match those URLs. The current provider setting was previously verified as unsigned; signature enforcement is not claimed to have been tested against real provider delivery.

The API exposes `/v1/billing/payments`, `/payments/:id`, `/check-quote`, `/subscriptions`, `/settings` and `/reconciliation`. An MFA tenant administrator can queue a new provider reconciliation through `POST /v1/billing/payments/:id/reconcile` with `{}`; it does not mark a payment paid. Twelve automatic attempts are allowed before administrator intervention. No automatic refund, payout or cash workflow is introduced.

The four public callback URLs still target the separate sandbox receiver on port 3100. It stores bounded, deduplicated summaries without wallet data. Enabling the main API's billing routes does not replace that receiver or change the public URLs. The running receiver must be restarted to load new signature support; restarting the tunnel changes its URL.

## Input still required

| Requirement | Why it remains |
| --- | --- |
| Production onboarding and enabled operators/settlement access | This implementation deliberately uses the fixed pawaPay sandbox API. Production adapter configuration and activation remain a separate acceptance step. |
| Approved prices, exemptions, package benefits, periods and suspension rules | Sandbox rules are editable, but do not establish approved production policy or service entitlements. |
| Production registration payment activation | Sandbox receipts cannot be used as proof of real payment. A production confirmation writer must be connected after live billing rules and provider access are approved. |
| Business/receipt details and settlement statements | Selectable sandbox receipts and provider-status reconciliation are implemented; fiscal receipts and settlement-level reconciliation require these details. |
| SMS renewal delivery policy | Reminders are in-app; production reminder channels, recipients, templates and delivery arrangements remain pending. |
| Staff accounts, actual stock and approved incident wording | Controls act on existing authorized records and do not create accounts or grant roles. Physical stock discrepancies are recorded without inventing corrections. |
| Offline startup/access policy | Cold offline sign-in remains gated; no cached profile is treated as a fresh role grant. Already-saved encrypted drafts and submitted retries are preserved. |
| Android/provider acceptance | Local tests and exports do not establish device storage, foreground reconnection or complete live-provider app acceptance. |

## Verification

Final backend build and full suite passed **116 tests**, including the existing non-superuser migration checks with 024/025 installed. The affected 31-test suite also passed independently. Billing checks cover authorization, real migrated database behavior, paid check → owner response, quota rollback and phone sharing, uncertain provider outcomes, mismatch rejection, renewal reinstatement and HTTP boundaries. The new read-only migration verifier returned all true in the test database.

Final mobile typecheck, lint and **87 tests** passed after integration and SDK patch updates, including the new billing contract/translation checks. Expo compatibility is current after updating the four SDK 57 patch packages. Android and web exports passed; bundle verification is separate from device acceptance.

The dependency installer reported **28 npm advisories (10 moderate, 18 high)**. No broad or breaking `npm audit fix` was performed as part of this milestone. Release dependency review belongs to Milestone 4.

Test coverage uses real PostgreSQL-compatible test databases and HTTP handlers, with a controlled provider collaborator for business integration. Earlier provider smoke tests used the real pawaPay sandbox. Full app journeys against real provider callbacks and Android hardware still require acceptance.
