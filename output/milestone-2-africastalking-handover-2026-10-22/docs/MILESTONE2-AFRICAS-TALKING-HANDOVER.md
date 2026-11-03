# Milestone 2 Africa's Talking handover — 22 October 2026

The current workspace implements Africa's Talking SMS, the Supabase OTP send
hook, inbound SMS/USSD, persistent encrypted channel state, delivery tracking,
replay protection, owner PIN enrollment/action proofs and mobile PIN screens.
These changes are locally tested. They are not hosted/provider acceptance.

## SQL to apply to the current hosted project

The read-only hosted inspection found 024/025 operations present and 026–029
absent. The available connection is a runtime login, not the schema owner; no
hosted SQL was applied. Start with [preflight](../supabase/preflight-milestone2-telecom.sql)
and confirm the project's migration history. Do not replay installed files.

Stop old API/SMS workers before the transport migration, then apply each missing
file once, in this order, through the schema-owner/project-owner SQL connection:

1. [026 billing operations](../supabase/migrations/202610130026_billing_operations.sql)
   — prerequisite for the shared channel/allowance and administration checks.
2. [027 Africa's Talking SMS](../supabase/migrations/202610210027_africastalking_sms.sql)
   — generalized account/message identifiers and early delivery-report correlation.
3. [028 telecom channels](../supabase/migrations/202610210028_telecom_channels.sql)
   — encrypted state, durable direct-send claims, channel verification, scoped
   references, narrow allowance integration and aggregate health status.
4. [029 owner PIN/step-up](../supabase/migrations/202610220029_owner_pin_step_up.sql)
   — OTP-confirmed enrollment, adaptive PIN hashes, lockout, one-use action proofs,
   private audit and verified USSD PIN decisions.

026 needs the existing migrations through 025. On another project, apply missing
prerequisites in their original order rather than assuming this project's state.
All these files are run-once migrations. Migration 027 renames `account_sid`;
an old Twilio deployment must not keep running against the new schema.

Run the appropriate read-only verifiers after installation:

- [Billing operations](../supabase/verify-billing-operations.sql).
- [Africa's Talking/channel isolation](../supabase/verify-africastalking-telecom.sql)
  — all eight results true.
- [Owner PIN isolation/gates](../supabase/verify-owner-pin.sql) — all nine results true.
- Existing [022](../supabase/verify-twilio-sms-delivery.sql) and
  [023](../supabase/verify-milestone2-workflows.sql) checks remain useful for the
  historical outbox/workflow foundations.

## Runtime setup

Use the current workspace's backend/mobile source with the supplied
[environment template](../backend/.env.example). This handover is not a standalone
application deployment. Never copy the ignored real `.env` into an archive.

Follow [Africa's Talking setup](AFRICAS-TALKING-SETUP.md) and
[owner PIN setup](OWNER-PIN-SETUP.md) for exact flags, routes, credentials and policy
fields. Local encryption/signing secrets have been prepared without printing
their values. No provider API key, sender, shortcode or USSD code was supplied.
All sending/channel/hook/PIN flags remain off.

Required external setup:

- Client-owned Africa's Talking application/API key, approved SMS sender,
  two-way SMS route/shortcode, USSD service code and controlled test phones.
- Trusted HTTPS ingress that verifies provider origin, strips spoofed gateway
  headers and injects the private backend ingress token. The token is not an
  Africa's Talking signature. Keep direct backend access restricted.
- Hosted Supabase phone authentication and the signed Send SMS HTTP Hook.
- Explicit TENANT_ADMIN PIN policy approval and limits before enabling it.
- Production prices/free-check entitlement rules, backup consent/delegation,
  seller mandates/listing-duration rules and device/operator acceptance.

## What is complete locally

- Twilio runtime SDK/routes/settings replaced; historical migration/audit retained.
- SMS acceptance/receipts, retry/quarantine, early/duplicate/out-of-order reports.
- Signed raw-body OTP hook, timestamp validation, rotation and durable replay handling.
- SMS commands and USSD menus with verified existing-account identity, encryption,
  scoped references, cumulative retries, dropped-session/restart handling and throttles.
- Shared sandbox check allowances; no grant of general Auth sessions or staff MFA.
- Owner PIN enrollment, salted scrypt, persistent lockout, action/session/phone-bound
  proofs, check/sale enforcement, private audit, app flows and USSD PIN responses.
- Evidence encryption key rotation with backward-compatible reads.
- Aggregate telecom monitoring endpoint, preflight and read-only setup checker.
- Six Expo SDK 57 patch updates recommended by Expo compatibility checks.

## Verification record

Final result: backend build and **142/142 tests pass**; mobile typecheck/lint and
**93/93 tests pass**, compatibility is up to date, and Expo Doctor passes **21/21**.
Web and Android Hermes bundle exports succeed. These are bundle checks, not APK
installation, deployed provider acceptance or physical handset tests.
The packaged validation report and logs record these results.
Local SQL tests use PGlite and include installation under a non-superuser schema
owner. They do not prove real multi-connection PostgreSQL load, handset delivery,
operator menu limits or hosted deployment.

The backend production dependency audit reports zero advisories. The mobile audit
still reports 21 transitive/direct advisories (3 moderate, 18 high). Compatible SDK
patches were applied. The audit's remaining automated suggestions include
incompatible SDK changes/downgrades; no forced downgrade was applied. Review the
included audit reports before release.

## Work still requiring decisions, access or external acceptance

- Hosted 026–029 installation/verification and API/worker deployment.
- Provider resources, tariffs, ingress origin controls, Supabase hook and actual
  sandbox/handset tests. DRC-specific USSD support is documented by the provider;
  current SMS routing and account provisioning still need confirmation.
- Approved production paid-check/free-check integration and production release gates.
- PIN policy acceptance, assisted PIN/phone recovery and a secure SMS-only
  sensitive-action policy. Ordinary SMS never accepts a reusable PIN.
- Accepted backup-contact consent/delegation/delivery; seller mandates and automatic
  listing expiry. These workflows are not fabricated from unapproved rules.
- Real database concurrency/load, physical devices, restore/key recovery, approved
  retention/malware scanning, deployed monitoring/alerts and security review.

Operational check flows remain explicitly synthetic/TEST and recipient-allowlisted.
No local test, provider acceptance response or PIN screen is production clearance.
