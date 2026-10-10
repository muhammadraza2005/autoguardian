# Milestone 2: Twilio operational SMS

The sending worker, signed callback endpoint, persisted attempts and delivery
audit are implemented. Backend build and all 70 tests pass, including seven SMS
tests. Migration 021 was installed and its eight checks reported true by the
project owner on 10 October 2026. Migration 022 and Twilio account setup remain
pending. No live messages were sent. Supabase Auth OTP is separate, in module 3.

## Create the development account

1. [Create the developer's Twilio account](https://www.twilio.com/try-twilio).
   Verify email and personal phone, then select SMS Messaging in the Console.
   Follow [Twilio's walkthrough](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account).
2. Obtain an SMS-capable sender suitable for the destination: a phone number in
   E.164 format or a Messaging Service with an appropriate sender pool.
   Account SID starts with `AC`; Messaging Service SID starts with `MG`.
3. Copy Account SID and the primary Auth Token from Console into local
   `backend/.env`. Keep the token out of chat, committed files, mobile variables
   and screenshots. Leave existing database/encryption settings intact.
4. Add only controlled test destinations to the sample recipient list.
   Current trials require verified recipients, restrict SMS to the signup
   country and restrict custom message bodies. AutoGuardian templates and
   cross-country +243 tests may require upgrading the development account.
   Check the account-specific Console rules first.
   [Current trial restrictions](https://www.twilio.com/docs/usage/trials).
5. For an eligible account, check destination geographic permissions and sender
   routing before DRC pilot testing. Enabling a country alone does not prove the
   selected operator route works.
   [SMS geographic permissions](https://www.twilio.com/docs/messaging/guides/sms-geo-permissions).

Twilio currently lists **two-way SMS as unsupported in DRC**. Outbound alerts
can be tested separately; module 8 requires a supported inbound route/provider
decision before implementing CHECK, APPROVE or REFUSE replies.
[DRC guidance](https://www.twilio.com/en-us/guidelines/cd/sms).

## Install the database component

Run as `postgres` in Supabase SQL Editor:

1. [Migration 022](../supabase/migrations/202610100022_twilio_sms_delivery.sql),
   once, after installed 021. Do not replay 021 or earlier installed migrations.
2. [Read-only verifier](../supabase/verify-twilio-sms-delivery.sql). All eight
   columns should be true. It enables no messaging and returns no phone data.

022 extends transport states and adds two forced-RLS tables. The non-login SMS
executor has no BYPASSRLS and is not inherited by the runtime login. Only four
reviewed operations are granted directly to the existing restricted login. A
narrow administrator-owned Auth gateway retrieves confirmed, normalized recipient
phones for server dispatch; clients/runtime roles cannot call it directly.
Delivery events are append-only. No credentials, sender or phone is seeded.

## Configure the server

Append the fields from [backend/.env.example](../backend/.env.example) to your
existing ignored `backend/.env` and fill them locally:

```dotenv
TWILIO_SMS_ENABLED=false
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PREVIOUS_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
TWILIO_MESSAGING_SERVICE_SID=
TWILIO_STATUS_CALLBACK_BASE_URL=
TWILIO_SAMPLE_RECIPIENTS_JSON=[]
```

Set exactly one sender: FROM_NUMBER or MESSAGING_SERVICE_SID. The callback base
must be an exact public HTTPS URL ending in `/v1/webhooks/twilio/sms`, without a
query or trailing slash. Local development needs an HTTPS tunnel to the backend.
The proxy must preserve that path. Signature validation uses this configured
public URL and never trusts Host/forwarded headers.

Use a JSON array of E.164 strings for recipients, at most 20 explicit test
destinations. Supabase Auth must also confirm each linked recipient's phone;
Twilio Console recipient verification alone does not establish Supabase proof.
Supabase phone OTP setup follows in module 3. This implementation does not buy
a sender, upgrade billing or provision a tunnel automatically.

When ready, set `TWILIO_SMS_ENABLED=true` and restart the API. It exposes
`POST /v1/webhooks/twilio/sms/:notificationId/:attemptId`. Outgoing messages each
set their full callback URL; do not paste a fixed sample attempt ID into Console.
The endpoint accepts signed Twilio form POSTs and returns 204. It is not an
inbound SMS reply endpoint and does not use an app Bearer token.

From `backend/`:

```powershell
npm.cmd run build
npm.cmd start
```

In a second terminal, after intentionally enabling SMS:

```powershell
npm.cmd run sms:worker
```

The worker processes one notification at a time and polls every two seconds
when idle. `npm.cmd run sms:worker -- --once` claims at most one due job and exits.
Starting the API alone sends nothing. An enabled worker can send real, chargeable
SMS to the configured test destinations.

Synthetic requests still require explicit module 1 configuration. The worker
consumes that existing outbox; it does not create checks. Consumer lookup, owner
inbox and production gates remain later modules. English/French templates are
labelled TEST, reveal no private owner data and direct users to the app. They
neither provide a sale authorization nor accept replies.

## Reliability rules

- A transaction claims a queued notification and persists its unique attempt
  before submission. Row locks and SKIP LOCKED prevent duplicate worker claims.
- Expired/answered owner alerts, expired results, changed ownership, unavailable
  recipients, unconfirmed phones and non-allowlisted destinations cannot be
  newly submitted. A send already in flight cannot be recalled atomically.
- Provider acceptance is `submitted`, not delivered. Signed receipts advance
  sent/delivered/failed. Duplicates are idempotent, stale receipts cannot regress
  state and the first terminal receipt remains terminal.
- Each attempt binds account, notification, message SID and a recipient digest.
  An early callback can bind the SID before the API response is saved. Delivery
  events never approve/refuse a vehicle check.
- Definite HTTP 429 rejections retry after 30 and 60 seconds, for at most three
  submissions. SDK retries are disabled. Other definite 4xx errors fail without
  retries. [Twilio's 429 guidance](https://www.twilio.com/docs/api/errors/20429).
- Timeouts/network/5xx uncertainty is `unknown`, with no automatic resend. A
  crashed sending attempt becomes unknown after a 60-second persisted lease.
  A later signed receipt can resolve it. Database failure after submission
  stops the worker and cannot cause a second send. No exactly-once provider
  submission guarantee is claimed for the Messages API.
- Provider error codes are retained. Error text, message bodies, callback bodies,
  tokens and raw phones are not persisted in delivery history. Phone digests
  remain private data. Accepted sends lacking receipts stay submitted/sent and
  require provider-log investigation; delivery is never invented.

## Acceptance and handover

Tests cover configuration/provider mapping, PostgreSQL attempt and audit rules,
early/duplicate/out-of-order receipts, exact-URL signatures, additional future
fields, correlation mismatches, bounded backoff, uncertain-send recovery, obsolete
alerts, unverified phones, denied grants and non-superuser migration installation.
Provider sends are stubbed. Real delivery, DRC carrier coverage and multi-connection
contention still need acceptance on the configured environment.

Live acceptance requires migration 022, an account/sender, reachable HTTPS
callbacks, confirmed Supabase recipient phones and a synthetic request. Confirm
the SID and delivered/failed event in Twilio logs and the database, and verify
invalid signatures cannot change it before marking module 2 fully complete.

For client handover, stop the old worker, review outstanding attempts, replace
server-only account/token/sender settings and recipient whitelist, then repeat
acceptance. Keep the old callback deployment available for unsettled messages
whose callback URLs point there. PREVIOUS_AUTH_TOKEN supports same-account token
rotation only; a different account cannot alter an existing attempt. Production
check authorization remains gated separately.

References: [request security](https://www.twilio.com/docs/usage/security),
[Message API](https://www.twilio.com/docs/messaging/api/message-resource),
[callback lifecycle](https://www.twilio.com/docs/messaging/guides/outbound-message-status-in-status-callbacks).
