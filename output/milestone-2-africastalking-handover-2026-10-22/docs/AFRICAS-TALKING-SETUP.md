# Africa's Talking SMS, OTP and USSD setup

Implemented locally on 21–22 October 2026. The backend now uses Africa's Talking's
HTTP SMS API; the Twilio runtime SDK/routes/settings have been removed. Real
provider configuration and handset acceptance remain pending. See
[Milestone 2](../milestone-2.md) for overall release status.

## What is implemented

- A separate SMS worker, durable outbox, opaque provider message IDs, per-recipient
  acceptance, delivery receipts, bounded 429 retries and uncertain-send quarantine.
  API status codes 100/101/102 mean accepted/queued/sent, not handset delivery.
- A signed Supabase Send SMS Hook with raw-body verification, freshness checks,
  secret rotation, resend cooldown and a durable send ledger. Supabase still
  creates/verifies OTPs and issues app sessions.
- Form callbacks for inbound SMS and USSD. Users verify an existing confirmed
  account by an SMS OTP entered in USSD; no account/role is created by a callback.
  The verified channel lasts ten minutes; decisions require verification within
  five minutes. These are development security limits, not approved business policy.
- Persisted encrypted USSD state, cumulative-input validation, restart/replay
  handling, per-phone throttles, five attempts per challenge, a three-minute
  session deadline and a one-minute OTP-send cooldown. Only HMACs of entered
  inputs persist; encrypted send intents are held briefly for reliable dispatch.
- CHECK PLATE/CHASSIS/SEAL, STATUS, APPROVE, REFUSE and HELP through the existing
  check services. SMS uses a channel verified through USSD first. Request references
  are twelve random hex characters, scoped to the verified account and valid for
  at most a day; actual result expiry and owner deadlines still apply.
- Sandbox billing allowances are consumed through the same transaction as check
  creation. A phone channel cannot satisfy staff MFA or general Supabase sessions.
- Evidence encryption can use a versioned key ring while retaining legacy reads.
- `GET /v1/telecom/status` provides aggregate queue/send/session counts to a current
  MFA-authenticated TENANT_ADMIN. It returns no message bodies or phone numbers.

All operational check replies are **TEST** and use the existing synthetic check
gate. The [owner PIN module](OWNER-PIN-SETUP.md) is implemented with a separate
disabled policy; this build does not enable production checks, real paid-check
entitlements, backup delegation or seller mandates. Only explicitly
allowlisted controlled recipients can receive SMS, even in the live environment.

## Coverage and account resources

Africa's Talking's [DRC-specific USSD page](https://help.africastalking.com/en/articles/11462631-ussd-drc)
confirms dedicated USSD on Orange, Airtel, Vodacom and Africell. This is more
specific than its older general country list. Obtain current provisioning,
prices, operator approval and account activation; separately confirm outbound
and two-way SMS routes. No messages or applications were provisioned by Codex.

Use the [Sandbox simulator](https://help.africastalking.com/en/articles/1170660-how-do-i-get-started-on-the-africa-s-talking-sandbox)
first. A sender ID, two-way SMS shortcode and USSD code are distinct resources.
Production resources belong to the client. Sandbox simulator results do not prove
delivery to real handsets. Check [current SMS response/receipt meanings](https://help.africastalking.com/en/articles/16150386-messaging-error-codes)
when accepting an operator route.

## Install and verify SQL

1. Check hosted migration history and install missing prerequisites through 026
   in order, following their existing setup documents. Do not replay installed SQL.
2. Apply [027](../supabase/migrations/202610210027_africastalking_sms.sql) once.
   It renames `account_sid` to `provider_account`, preserves historical records
   and adds bounded unmatched-receipt storage. Stop old workers before migrating.
3. Apply [028](../supabase/migrations/202610210028_telecom_channels.sql) once.
   It adds encrypted channel/session state, dispatch claims, scoped references
   and a narrow billing-session bridge. It does not grant staff/session proof.
4. Run the [read-only verifier](../supabase/verify-africastalking-telecom.sql).
   All eight columns must be true. Run earlier 022/023 verifiers as well.
5. Apply [029](../supabase/migrations/202610220029_owner_pin_step_up.sql) and run
   its [PIN verifier](../supabase/verify-owner-pin.sql) before enabling PIN support.

Use the migration/schema-owner connection, not the restricted runtime login.
The read-only hosted inspection on 22 October 2026 found 024/025 operations present
and 026/027/028/029 operations absent. The available connection does not own the private schema and
cannot manage migration roles. Hosted SQL was not changed.

## Configure secrets and trusted ingress

Use [backend/.env.example](../backend/.env.example). New local signing/encryption
secrets were generated in the ignored `backend/.env`; existing settings were
preserved and all three feature flags remain false. Back up the telecom key
securely. No Africa's Talking API key/sender/code was available locally.

For Sandbox, set environment/username to `sandbox`, fill the Sandbox API key,
approved sender and 1–20 controlled E.164 recipients. Fill the two-way shortcode
and full USSD service code. Enable each feature only after its dependencies:

```dotenv
AFRICASTALKING_SMS_ENABLED=false
AFRICASTALKING_CHANNELS_ENABLED=false
SUPABASE_SMS_HOOK_ENABLED=false
OWNER_PIN_ENABLED=false
```

The production environment additionally requires the provisioned application
username and `AFRICASTALKING_PRODUCTION_APPROVED=true`. That switch acknowledges
the environment configuration; it does not remove synthetic business gates.

Africa's Talking callbacks require a **trusted HTTPS ingress** which verifies
provider origin using controls agreed for the provisioned resource. At ingress,
strip caller-supplied `X-AutoGuardian-Gateway-Token` and inject the server-only
`AFRICASTALKING_GATEWAY_TOKEN` after origin validation. Bind the backend to loopback
or restrict its network to that ingress. Do not allow clients to bypass it.

This token authenticates ingress; it is not an Africa's Talking signature. No
undocumented provider signature/header is assumed. A public tunnel directly to
these endpoints without validated ingress is insufficient for accepting decisions.
Configure callback payload/body limits and prevent logging bodies, raw phone
numbers, reusable PINs, OTPs or callback credentials at ingress and backend.

Configure these public HTTPS routes on the corresponding Africa's Talking resource:

| POST route | Use |
| --- | --- |
| `/v1/webhooks/africastalking/sms/delivery` | SMS delivery reports: `id`, `phoneNumber`, `status`. |
| `/v1/webhooks/africastalking/sms/inbound` | Incoming SMS: `id`, `from`, `to`, `text`; extra route metadata is bounded. |
| `/v1/webhooks/africastalking/ussd` | `sessionId`, `serviceCode`, `phoneNumber`, cumulative `text`; returns plain-text CON/END. |
| `/v1/webhooks/africastalking/ussd/events` | Session-end events including `sessionId`; closes existing local state idempotently. |

These are form POSTs; repeated fields, JSON forms and query parameters are rejected.
Confirm event/receipt payloads on the provisioned resource during Sandbox setup.
Unknown receipt statuses fail closed until reviewed. SMS delivery never changes
an owner decision. The old `/v1/webhooks/twilio/...` route returns 404.

## Configure Supabase Auth

In the intended Supabase project's Auth Hooks settings, configure **Send SMS**
with `https://<api>/v1/webhooks/supabase/send-sms` and the matching locally prepared
`SUPABASE_SMS_HOOK_SECRET`. Use its exact signing secret; do not paste it into chat.
This hook uses Supabase's Standard Webhooks headers, not the ingress-token scheme.
Keep the request's original JSON bytes intact through ingress.

Enable phone authentication and confirm configured OTP length/expiry/rate limits.
The app keeps using Supabase `signInWithOtp`/`verifyOtp`. Test delivery before
relying on the hook; a disabled/unreachable hook must never yield a local success.
The [official hook contract](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook)
accepts an empty successful response. This handler returns HTTP 200 with `{}`
only after provider acceptance or a previously accepted exact retry.

## Run and accept

From `backend/`:

```powershell
npm.cmd run build
npm.cmd run telecom:check
npm.cmd start
```

Start `npm.cmd run sms:worker` and `npm.cmd run checks:worker` separately. Starting
the API does not drain the operational SMS outbox. Auth/USSD challenges and SMS
command replies can send when their flags are enabled; this can incur charges.
An uncertain direct-send claim remains unconfirmed and is never automatically
replayed. Request a new challenge after expiry rather than deleting its ledger.

Run `npm.cmd test`. Local tests cover forged/stale hooks, replay/restart, unknown
sends, early receipts, tenant/recipient scope, scoped references, USSD-to-SMS
decisions, shared allowances, forced RLS and key rotation. PGlite validates SQL
semantics but does not establish real multi-connection race/load acceptance.

Then record actual simulator and handset evidence separately: OTP success/failure,
owner approval/refusal, timeout/expiry, delivery failure, invalid commands,
dropped sessions, bilingual menu limits, cross-channel decisions and each agreed
operator. Client resource provisioning, trusted ingress, owner PIN policy acceptance,
live paid-check entitlement, consent/delegation and seller rules remain release work.

## Evidence key recovery and rotation

`AUTOGUARDIAN_REPORT_EVIDENCE_KEY` remains the legacy read key. To rotate new
uploads, configure `AUTOGUARDIAN_REPORT_EVIDENCE_KEYS_JSON` as a mapping of version
names to 32-byte hex keys and select `AUTOGUARDIAN_REPORT_EVIDENCE_ACTIVE_KEY`.
Retain old entries and the legacy key while their files exist. New ciphertext
authenticates its version as well as tenant/report/file identity. Removing a key
fails affected reads closed; changing a version label cannot decrypt a file.
Back up keys outside the database and prove restore in a separate environment.
Retention decisions, malware-scanner integration and deployed monitoring/alerts
are still outstanding. The aggregate status endpoint is available for wiring
operational alerts after hosted setup.
