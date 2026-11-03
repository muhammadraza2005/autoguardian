# Milestone 2: Africa's Talking SMS and USSD integration plan

Revised 21 October 2026. The client selected Africa's Talking for both SMS and
USSD. Backend adapters, forward migrations and local tests now implement this
brief; see the [current setup guide](AFRICAS-TALKING-SETUP.md) for actual configuration
and limits. Hosted/provider acceptance is pending. The
[Milestone 2 checklist](../milestone-2.md) records status; Twilio is superseded.

## Scope and dependencies

| Channel | Required behavior |
| --- | --- |
| Auth SMS | Supabase creates/verifies the OTP; a Send SMS HTTP Hook delivers through Africa's Talking. |
| Operational SMS | Owner alerts, reminders, buyer results and approved backup alerts use the existing durable outbox and a new Africa's Talking transport. |
| Inbound SMS | CHECK, STATUS, APPROVE, REFUSE and HELP use a provisioned two-way route and the shared account/authorization services. |
| USSD | Short English/French menus support checks, owner inbox, approval/refusal and result retrieval through the same services. |

Provision outbound sender identity, inbound SMS shortcode/route and USSD service
code as distinct resources. Include reply rules, SMS segments, USSD session/end-user
charges, setup fees and recurring costs in the client cost review; no price or
coverage guarantee is inferred from the provider choice.

The planned pilot is Kinshasa/DRC. Africa's Talking's [DRC-specific page](https://help.africastalking.com/en/articles/11462631-ussd-drc)
confirms dedicated USSD on Orange, Airtel, Vodacom and Africell; this corrects the
earlier inference from its incomplete general country list. Confirm current
allocation/pricing, outbound/two-way SMS routing and callback-origin controls
for the client's application. Live acceptance remains pending.

## Build sequence

1. Create/use a development Sandbox app, configure a two-way SMS resource and
   USSD channel, and establish public HTTPS callbacks. Keep production resources,
   secrets and recipients separate. The [Sandbox guide](https://help.africastalking.com/en/articles/1170660-how-do-i-get-started-on-the-africa-s-talking-sandbox)
   describes simulator testing; it is not real handset acceptance.
2. Inspect the current migration head and add a new migration after it. Preserve
   installed 022/023 and subsequent Milestone 3 migrations. Generalize account SID
   and message SID constraints into explicit provider/application identity and
   opaque provider message IDs; version or replace the SMS SQL operations and
   validators while retaining historical attempts, append-only receipts, RLS and
   restricted grants. Do not replay or rename installed migrations.
3. Replace `backend/src/sms.ts` transport, API controller registration in
   `app.ts`/`main.ts`, worker configuration and tests. Use the [official Node.js
   SDK](https://github.com/AfricasTalkingLtd/africastalking-node.js) or documented
   HTTP API. Validate per-recipient responses, delivery mappings, limits and retry
   rules against the selected version and account. Persist message IDs against
   provider/application/attempt; never treat acceptance as delivery. Preserve
   unknown-send quarantine, bounded retries and terminal-state deduplication.
4. Implement Supabase's [Send SMS Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook)
   for Africa's Talking OTP delivery. Verify signed raw-body requests and freshness
   using the supported hook verifier, deduplicate hook retries, return the documented
   success/error contract, and leave OTP/session verification in Supabase. Keep OTPs
   out of logs and the operational outbox. Preserve existing phone binding and
   re-verification after changes.
5. Implement the inbound SMS adapter around `backend/src/basicPhone.ts`, with
   durable inbound-message deduplication and scoped references mapped to request
   UUIDs. Authenticate the callback origin separately from account verification;
   bind existing verified accounts and approved step-up to the shared services.
6. Implement the Africa's Talking USSD adapter around the shared basic-phone
   service. Use durable/shared sessions, cumulative-input replay handling and
   atomic operation keys. Add session-end event handling and operational metrics.
7. Validate sandbox journeys, then configure the client's resources and run real
   network/device acceptance. Remove runtime Twilio dependency/routes/settings
   after the replacement passes. Preserve historical audit and migration files.

## Proposed callback boundaries

These routes are now implemented and registered only when their features are
enabled. See the current setup guide for trusted ingress and payload requirements.

| Proposed POST route | Purpose and contract |
| --- | --- |
| `/v1/webhooks/supabase/send-sms` | Signed Supabase Auth hook; reads Auth's user/OTP payload and sends via Africa's Talking. |
| `/v1/webhooks/africastalking/sms/delivery` | Delivery reports correlated by provider/application/message ID. Verify actual route payload/security before implementation; persist bounded unmatched early receipts for reconciliation. |
| `/v1/webhooks/africastalking/sms/inbound` | Form SMS callback; validate the route-specific message ID, sender, destination, text and any shortcode keyword/link metadata. Acknowledge after durable deduplication, then process commands. |
| `/v1/webhooks/africastalking/ussd` | Form callback with `sessionId`, `serviceCode`, `phoneNumber` and cumulative `text`; return `text/plain` beginning `CON ` or `END `. |
| `/v1/webhooks/africastalking/ussd/events` | Session-end events for idempotent cleanup/metrics; confirm enabled payload and resource configuration. |

Africa's Talking's [USSD example](https://africastalkingltd.gitbooks.io/mobile-communication-apis/content/python/programmer_level/ussd.html)
documents its callback/response convention. Provisioned codes need [callback and
event URLs](https://help.africastalking.com/en/articles/9915125-how-do-i-go-live-with-ussd).
Map cumulative text to session steps; do not feed every repeated callback into a
new check/decision. Bound response time and menu length to the agreed networks.
End sessions after submitting checks and send delayed results by SMS or allow a
fresh authenticated status lookup.

For Africa's Talking callbacks, establish the supported origin-validation
mechanism with the provider for the actual resource. Outbound API credentials and
Twilio signatures are not a substitute. Verify controls in Sandbox and production
before enabling sensitive actions; do not assume an undocumented signature header.

## Identity and privacy

Phone numbers in callbacks identify a channel; they do not independently prove
account ownership or permission. Basic-phone users need an approved linking,
verification and recovery path into existing accounts. Owner approval/refusal
requires the same ownership/deadline checks and approved PIN/step-up policy as
the app. Use a verified USSD challenge or another agreed secure challenge rather
than asking users to put reusable PINs in ordinary SMS messages. Exclude PIN-bearing
USSD text, OTPs, full message bodies and raw phones from logs/audit events.

Use short, scoped, expiring request references with guess protection. Maintain
buyer-result privacy and expiry, production payment/allowance gates, atomic
decisions and backup-contact consent. No channel bypasses these rules. Payment
provider implementation stays in Milestone 3; connect only trusted entitlement
results from that work.

## Configuration to introduce during implementation

- Server-only Africa's Talking environment selector, application username/API key,
  sender ID, inbound shortcode/keyword where needed, USSD service code, canonical
  callback URLs and the agreed callback-origin controls.
- Supabase Send SMS Hook URL and signing secret, verified hook rate/timeout
  settings, and existing Auth OTP expiry/rate limits.
- Explicit SMS/USSD enable flags, test-recipient restrictions, session TTL/storage
  and request throttling. Keep production sending disabled until configured.

The Sandbox username is `sandbox`; live uses the provisioned application username.
Exact environment names are now in `backend/.env.example`; `TWILIO_*` runtime
settings were removed. Do not share credentials in chat or mobile code.

## Acceptance evidence required

- Auth: correct OTP delivered, verified against the existing account; invalid,
  expired, resent, rejected and rate-limited cases fail correctly. Hook forgery
  and replay do not send unauthorized/duplicate OTPs.
- SMS: accepted/delivered/failed and out-of-order/duplicate reports, early receipt,
  per-recipient failure, provider outage/insufficient balance, bounded retry and
  unknown-send recovery without duplicate submission.
- Inbound: valid/invalid commands, duplicate callbacks, account linking, guessed
  references, unauthorized/late decisions, and cross-channel races yielding one
  final decision. Private results require the correct buyer identity.
- USSD: checks, owner inbox/decisions/status, English/French, invalid input,
  cumulative retries, timeouts, dropped sessions, application restart/multiple
  workers and end events. A new session can retrieve a persisted check safely.
- End to end: approval, refusal, timeout, expired result and failed delivery across
  app/SMS/USSD; include approved production gates and backup behavior.
- Record Sandbox evidence separately; then record actual OTP, outbound/inbound
  SMS and USSD handset results for each agreed live operator, client account,
  enabled resource, callback configuration and operational handover.
