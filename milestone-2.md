# Milestone 2 — Vehicle checks and owner responses

## Objective

Connect deferred SMS delivery and owner phone OTP verification, then complete the buyer-check-to-owner-response journey through the consumer app. Support plate, chassis and QR checks, permitted status information, owner alerts, secure approval/refusal, deadlines, backup alerts, incident and missing-vehicle reports, sale-status changes, and supported SMS/USSD journeys for basic phones.

Milestone acceptance includes approval, refusal, timeout and expired results. All modules below are required; priority determines development order.

## Provider and architecture decisions

- Use Twilio for SMS with Supabase.
- Use the developer's Twilio account in development/staging first; configure the client's account for production later.
- Keep credentials and sender configuration in server-side secrets, never client code or committed files.
- Separate Supabase Auth phone OTP from operational SMS notifications.
- Share backend operations and permissions across the consumer app, SMS and USSD adapters.
- Confirm inbound SMS support for the target market before implementing SMS replies.
- Select a USSD gateway and provision a code separately; start provider setup early.
- Close USSD sessions after creating requests; deliver delayed results through SMS or later status retrieval.

## Development modules

### 1. Backend rules and database — P0

- [x] Inspect existing schema, ownership model and project requirements before choosing migrations.
- [x] Define the exact vehicle information buyers may see; exclude private owner data.
- [x] Create or extend check requests, owner decisions, notification records and audit history.
- [x] Define request outcomes: `pending`, `approved`, `refused`, `timed_out`.
- [x] Store separate owner-response deadlines and buyer-result expiry times.
- [x] Enforce buyer and owner access permissions.
- [x] Accept decisions atomically, rejecting unauthorized, duplicate and late responses.
- [x] Verify access policies and state transitions with meaningful database tests.

Database component implemented in migration 021; the project owner reports hosted
installation and all eight verification checks true on 10 October 2026. Requests
are restricted to explicitly configured synthetic development checks; production
payment/allowance and owner step-up integration remain required. See
[rules, installation and limits](docs/VEHICLE-CHECK-RULES.md).

### 2. Twilio SMS integration — P0

- [ ] Configure development account and server-side secrets.
- [x] Implement SMS sending, delivery callbacks and failure tracking.
- [x] Validate provider webhook signatures.
- [x] Add duplicate protection and bounded retries.
- [x] Keep provider configuration replaceable for client handover.

Component implemented and locally tested with the official Twilio SDK, migration
022 and a separate worker. Live account/sender/secrets, hosted 022 installation,
HTTPS callback and actual delivery acceptance remain pending; the developer's
Twilio account is not created yet. See [setup steps](docs/TWILIO-SMS-SETUP.md).
Twilio currently lists two-way SMS as unsupported in DRC, so module 8 requires a
supported inbound route/provider decision.

Development completion below means implemented and locally tested with provider-independent fixtures. Live OTP/SMS/USSD and production payment/step-up acceptance remain pending. See [handover and SQL order](docs/MILESTONE2-HANDOVER.md).

### 3. Owner phone OTP verification — P0

- [ ] Connect Supabase Auth with Twilio.
- [x] Bind verified phone numbers to existing owner accounts.
- [x] Normalize phone numbers and implement OTP entry, resend limits and expiry.
- [x] Require re-verification after phone changes.
- [x] Prevent unverified phones from authorizing owner responses.

### 4. Vehicle lookup and check creation — P1

- [x] Support plate, chassis and QR lookup with input validation.
- [x] Resolve all lookup methods through the same backend workflow.
- [x] Return only permitted vehicle status fields.
- [x] Create requests linked to buyer, vehicle and owner.
- [x] Handle unknown vehicles, invalid QR references and repeated-check limits.

### 5. Owner alerts and secure responses — P1

- [x] Queue owner alerts; verified recipient checks run before dispatch.
- [ ] Accept live delivery and production owner PIN/step-up.
- [x] Display pending requests in the owner app.
- [x] Implement approval and refusal using shared backend operations.
- [x] Verify ownership, request validity and deadlines before accepting decisions.
- [x] Reject duplicate, unauthorized and late responses.

### 6. Consumer app integration — P1

- [x] Connect plate/chassis input and QR scanning.
- [x] Display permitted vehicle information and pending state.
- [x] Show approved, refused and timed-out outcomes.
- [x] Update results through realtime events or polling.
- [x] Display expired results and offer a fresh check.

### 7. Deadlines, reminders and backup alerts — P1

- [x] Schedule unanswered-request timeout processing.
- [x] Persist reminder jobs and queue deduplicated reminder notifications.
- [x] Persist backup jobs held as awaiting_configuration.
- [ ] Deliver agreed backup alerts after accepted contacts/delegation are configured.
- [x] Stop notifications after final decisions.
- [x] Enforce deadlines and expiry on server reads/actions even when scheduled processing is delayed.

### 8. Basic-phone SMS checks and responses — P2

- [ ] Confirm inbound-capable sender and target-market support.
- [x] Implement CHECK, STATUS, APPROVE, REFUSE and HELP commands.
- [ ] Authenticate callbacks and bind responses to verified owners and requests.
- [x] Queue final buyer result notifications; real sending acceptance remains pending.
- [x] Handle invalid commands and expired references.

### 9. Incident and missing-vehicle reports — P2

- [x] Add incident submissions and evidence uploads where supported.
- [x] Add authorized missing/recovered updates.
- [x] Define review permissions and keep status history.
- [x] Show only permitted report information during checks.

### 10. Sale-status changes — P2

- [x] Define allowed sale-status transitions.
- [x] Permit authorized owner updates and record history.
- [x] Reflect changes in subsequent checks.
- [x] Keep check approval separate from ownership transfer and sale-status changes.

### 11. USSD integration — P2 (provider setup starts early)

- [ ] Confirm country, networks, gateway and service code.
- [x] Add short menus for checks, pending requests, decisions and results.
- [x] Reuse shared backend rules and authorization.
- [x] Support delayed results through SMS or later retrieval.
- [x] Test simulated session expiry, dropped-session status retrieval and duplicate input replay.
- [ ] Test provisioned gateway and real handset coverage.

### 12. Acceptance testing and client handover — release requirement

- [x] Test complete approval, refusal, timeout and expired-result journeys.
- [x] Test failed delivery, retries, duplicate callbacks and cross-channel decisions.
- [x] Verify privacy and buyer/owner access permissions.
- [x] Prepare implementation and handover documentation.
- [ ] Configure client Twilio account, sender, Auth provider and webhooks.
- [ ] Repeat real SMS and USSD tests with production configuration.

## Backend behavior to preserve

- A request transitions from `pending` to exactly one of `approved`, `refused`, or `timed_out`.
- `response_deadline_at` determines when the owner may respond.
- `responded_at` records when an accepted decision occurred.
- `result_expires_at` determines when the buyer must request a fresh check.
- Expiry is distinct from the recorded request outcome: preserve historical decisions while making expired results unusable as current authorization.
- SMS delivery status is distinct from the owner's decision.
- Owner approval applies to the check/request; it does not transfer ownership.
- Exact buyer-visible fields, deadline durations, result validity, fallback channels and target telecom market must be reconciled with existing project requirements.

## Implementation status

- Module 1 database component implemented after inspecting migrations 001–020, existing owner reads, `backend.md` and `whatsleft.md`.
- Migration 021 adds restricted shared SQL operations, five forced-RLS tables and a read-only verifier; the project owner reports hosted installation and all checks true.
- Module 2 implementation adds migration 022, sending/receipt operations, official SDK signatures, bounded retries, unknown-send quarantine and server-only settings. Hosted installation and real account configuration remain pending.
- Backend build and all 80 tests pass, including ten remaining-workflow tests, five check-rule tests and seven SMS tests. Mobile has 73 passing tests; typecheck, lint, compatibility and all 21 Expo Doctor checks pass.
- Buyer vehicle fields are explicitly allowlisted. Deadline/result durations require administrator configuration; proposed SRS values are not treated as approved defaults.
- Migration 023, shared HTTP APIs and native app screens implement the remaining provider-independent modules, including scheduling, report evidence/history and simulated SMS/USSD.
- Hosted installation, live Auth/SMS/USSD, production payment/PIN, backup delegation, seller mandates/listing duration, real device and multi-connection acceptance remain pending. The milestone is not production-complete.
