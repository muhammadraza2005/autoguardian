# Milestone 2 — Vehicle checks and owner responses with Africa's Talking

Africa's Talking is selected for SMS and USSD. As of 23 October 2026, hosted
migrations 026–029 and their security verifiers have been confirmed through the
restricted runtime login. Migration 030 adds vehicle-bound backup consent,
OTP-accepted seller mandates and 30-day listing expiry; its hosted installation
is pending. The app includes these flows and an administrator PIN policy screen.
The project owner approved alert-only backups, 30-day seller/listing limits and
a PIN policy of five attempts, 15-minute lockout and 60-second action proofs.
Provider credentials, public protected callbacks and actual sandbox acceptance
are still missing. No real-phone or production acceptance is claimed. Setup
instructions for this continuation are delivered directly in chat.

## Objective

Connect Africa's Talking SMS delivery, owner phone OTP verification and USSD, then complete the buyer-check-to-owner-response journey through the consumer app and basic phones. Support plate, chassis and QR checks in the app, plate/chassis and supported seal-code checks on basic phones, permitted status information, owner alerts, secure approval/refusal, deadlines, backup alerts, incident and missing-vehicle reports, and sale-status changes.

Milestone acceptance includes approval, refusal, timeout and expired results. All modules below are required; priority determines development order.

## Provider and architecture decisions

- Use Africa's Talking for outbound SMS, inbound SMS commands and interactive USSD. Twilio is superseded and is not a production dependency or planned fallback.
- Start with Africa's Talking Sandbox and simulator, then use the client's provisioned production application and target networks for live acceptance. Sandbox success does not prove handset delivery or coverage.
- Keep credentials and sender configuration in server-side secrets, never client code or committed files.
- Keep Supabase Auth responsible for generating/verifying OTPs and issuing sessions. Deliver its OTPs through an authenticated Send SMS HTTP Hook backed by Africa's Talking; keep this path separate from the operational SMS outbox.
- Share backend operations and permissions across the consumer app, SMS and USSD adapters.
- Provision SMS sender identity, a two-way SMS shortcode/route and a USSD service code through Africa's Talking. An alphanumeric SMS sender alone does not provide replies, and a USSD code is a separate resource.
- The pilot is Kinshasa/DRC. Africa's Talking's DRC-specific page confirms dedicated USSD on Orange, Airtel, Vodacom and Africell. Confirm current allocation/pricing and separately confirm outbound/two-way SMS routes; its older general country list is incomplete.
- Replace Twilio-specific SDK, callbacks, identifiers and database constraints through forward migrations; preserve installed migration history and existing audit records.
- Close USSD sessions after creating requests; deliver delayed results through SMS or later status retrieval.

See the [Africa's Talking integration brief](docs/AFRICAS-TALKING-INTEGRATION-PLAN.md)
for the proposed callback contracts, setup inputs and acceptance checklist.

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

### 2. Africa's Talking SMS integration and transport migration — P0

- [ ] Configure Africa's Talking Sandbox application, API key, sender and controlled simulator destinations using server-only secrets.
- [x] Replace Twilio sending with Africa's Talking's documented HTTP SMS API; remove runtime Twilio SDK/routes.
- [x] Add migration 027 for namespaced provider/application identity, opaque message IDs and status/error mapping; preserve historical records. Hosted installation remains pending.
- [x] Implement delivery-report callbacks, per-recipient status tracking and durable early-receipt correlation; locally tested.
- [ ] Establish and test the callback-origin verification supported by the provisioned Africa's Talking route. Do not reuse Twilio signature validation or treat an API key used for outbound requests as inbound callback proof.
- [x] Preserve duplicate protection, bounded retries and unknown-send quarantine with Africa's Talking response classification.
- [x] Add provider tests, disabled-by-default settings and client setup documentation. External acceptance is separate.

The worker now uses Africa's Talking. Migration 027 replaces Twilio SQL identifier
restrictions while preserving historical records; 028 adds encrypted channel/session
state and a durable direct-send ledger. A read-only hosted inspection found
026/027/028 operations absent; the available runtime connection cannot migrate.
Installed migration history is preserved.

Development completion below means implemented and locally tested with provider-independent fixtures. Live OTP/SMS/USSD and production payment/step-up acceptance remain pending. See [handover and SQL order](docs/MILESTONE2-HANDOVER.md).

### 3. Owner phone OTP verification — P0

- [x] Implement the Supabase Send SMS Hook with raw-body signature/freshness verification, secret rotation and durable replay protection.
- [ ] Configure the hook in hosted Supabase and accept actual OTP delivery, expiry and phone changes.
- [x] Test hook success/rejection, stale/future signatures, cooldown, replay/restart and uncertain sends locally; no OTP/body is logged.
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
- [x] Implement owner PIN setup with OTP confirmation, salted scrypt, persistent lockout and one-use action-bound proofs for app/USSD decisions and app sale changes; include private audit events and mobile PIN screens.
- [ ] Approve/configure PIN policy, accept actual OTP/PIN handset flows and live alert delivery; production check/payment release gates remain separate.
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

### 8. Africa's Talking basic-phone SMS checks and responses — P1

- [ ] Provision an Africa's Talking two-way shortcode/route and confirm target-network coverage and reply charging.
- [x] Implement CHECK, STATUS, APPROVE, REFUSE and HELP commands.
- [x] Implement inbound SMS callbacks with payload/shortcode validation, trusted-ingress authentication, durable deduplication and shared operations. Actual provider-origin validation at ingress remains deployment work.
- [ ] Bind numbers to existing verified accounts and requests; integrate the approved owner PIN/step-up challenge. A sender number or request reference alone cannot authorize a decision. Keep PINs/OTPs out of ordinary SMS commands and logs.
- [ ] Provide an account-linking/recovery path for basic-phone buyers and owners; resolve buyer entitlement through the same payment/allowance rules as the app.
- [x] Implement scoped, expiring request references; test cross-owner access and duplicate decisions.
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

### 11. Africa's Talking USSD integration — P1 (provisioning starts at P0)

- [ ] Confirm Africa's Talking country/network support and provision a sandbox channel, then a production USSD service code with callback/event URLs.
- [x] Add short menus for checks, pending requests, decisions and results.
- [x] Reuse shared backend rules and authorization.
- [x] Support delayed results through SMS or later retrieval.
- [x] Test simulated session expiry, dropped-session status retrieval and duplicate input replay.
- [x] Implement the form callback with CON/END replies and short menus. Operator limits still need acceptance.
- [x] Add encrypted PostgreSQL session state bound to application/code/phone, cumulative replay checks and transaction locks; test restart/retry behavior. Real multi-connection acceptance remains pending.
- [ ] Verify callback origin, validate the configured service code, add throttling, and require approved account verification/owner step-up before private reads or decisions. Do not persist/log raw PIN-bearing input.
- [x] Implement idempotent session-end events and end sessions after creating requests; provide French/English menus.
- [ ] Accept actual provisioned event payloads, response deadlines and menu limits on each target network.
- [ ] Test provisioned gateway and real handset coverage.

### 12. Acceptance testing and client handover — release requirement

- [x] Test complete approval, refusal, timeout and expired-result journeys.
- [x] Test failed delivery, retries, duplicate callbacks and cross-channel decisions.
- [x] Verify privacy and buyer/owner access permissions.
- [x] Prepare implementation and handover documentation.
- [ ] Configure the client's Africa's Talking application, SMS sender/two-way shortcode, USSD service code, authenticated callbacks and Supabase Send SMS Hook.
- [ ] Pass Africa's Talking Sandbox scenarios for OTP, outbound/inbound SMS, delivery reports and USSD; record these separately from live acceptance.
- [ ] Repeat real SMS and USSD tests with production configuration.
- [x] Remove runtime Twilio SDK/configuration/routes; preserve historical SQL/audit records. Stop old deployments before hosted migration.

## Integration order — revised 21 October 2026

1. Begin Africa's Talking coverage/resource/cost confirmation and sandbox setup for SMS and USSD in parallel with development. No further provider selection is needed.
2. Generalize the persisted SMS transport through a forward migration, replace sending/receipts, and verify retry/deduplication behavior.
3. Connect Supabase's Send SMS Hook and accept phone OTP/account binding in the sandbox.
4. Connect inbound SMS commands and USSD menus to the same authorized check/decision services, with durable sessions and approved basic-phone identity/step-up.
5. Run sandbox cross-channel journeys; then accept OTP, two-way SMS and USSD on real phones for every agreed production network. Complete client handover after the existing production gates also pass.

## Remaining tasks and responsibility — updated 21 October 2026

This consolidates the outstanding module and release tasks above; it is not a
second completion count. Applying SQL does not configure providers or establish
live delivery acceptance.

### Database installation and verification

- [x] Apply hosted migrations 022 and 023 — reported complete by the project owner on 13 October 2026.
- [ ] Run/review [022 verification](supabase/verify-twilio-sms-delivery.sql) and [023 verification](supabase/verify-milestone2-workflows.sql), and record all checks passing. Codex can verify with database access; otherwise the project owner runs the read-only SQL and supplies the results.
- [x] Implement migrations 027/028 for Africa's Talking and migration 029 for owner PIN/step-up; validate schema-owner installation locally.
- [ ] Apply missing hosted migrations 026 → 027 → 028 → 029 and run their verifiers with a schema-owner connection. Read-only inventory on 22 October found 024/025 present; installed files must not be replayed.

### Input needed from the project owner/client

- [ ] Provide Africa's Talking Sandbox access and the client-owned production application's username/API key through server-side secret configuration; no Twilio account is needed.
- [ ] Confirm target country/networks and obtain Africa's Talking confirmation of outbound SMS, two-way SMS and USSD availability for the DRC/Kinshasa pilot; provide sender approval, SMS shortcode, USSD code, tariffs, setup/recurring charges, lead times and callback-security details.
- [ ] Approve buyer fees/free-check allowances, owner PIN/step-up policy, response deadlines, result validity and reminder timing.
- [ ] Approve backup-contact consent/delegation and whether contacts may respond, plus seller mandates and listing duration.
- [ ] Provide controlled buyer/owner accounts and phones, and participate in real OTP, SMS and USSD handset tests.

### Technical work Codex can handle

- [x] Implement and locally test Africa's Talking SMS transport, forward SQL, delivery callbacks and Supabase Send SMS Hook.
- [x] Implement inbound SMS adapters bound to OTP-verified existing accounts and scoped requests. Production identity/PIN policy still needs approval.
- [x] Implement USSD adapters, encrypted/shared sessions, OTP challenges and throttles.
- [ ] Apply/verify hosted migrations; configure resources, Supabase hook and trusted ingress; accept actual simulator/network behavior.
- [x] Implement configurable owner PIN setup, audited lockout and action-bound proofs, plus app/USSD PIN integration. No client policy is seeded or enabled; see [PIN setup](docs/OWNER-PIN-SETUP.md).
- [ ] Connect approved live paid-check/free-check entitlements and accept the production PIN/identity policy. Synthetic checks cannot authorize production activity.
- [ ] Implement accepted backup contacts/delegation and actual backup delivery.
- [ ] Implement accepted seller mandates and listing-duration enforcement.
- [ ] Verify development timing/limits, worker configuration, QR signing and the dedicated report-evidence encryption key.
- [ ] Run real PostgreSQL multi-connection race/load acceptance and app/device journeys, with project-owner participation for handset actions.
- [x] Implement versioned evidence encryption keys and test legacy reads, rotation, missing keys and tampered version labels.
- [x] Add a current-MFA TENANT_ADMIN telecom health endpoint returning aggregate counts without phones or message bodies.
- [ ] Prove key backup/recovery; complete approved retention, malware scanning, monitoring and security acceptance.
- [x] Review backend production dependency advisories; the current npm production audit reports zero. Apply the six recommended Expo SDK 57 patch updates and pass compatibility/typecheck/lint/Doctor.
- [ ] Resolve remaining mobile transitive advisories through a reviewed compatible dependency plan before release; do not force an incompatible SDK downgrade/upgrade.
- [ ] Repeat approval, refusal, timeout, expiry, failed delivery and cross-channel journeys with client production configuration, then update handover evidence.

Codex can prepare and implement technical work; account access, provider
provisioning, approved business rules and physical handset actions remain
dependencies. No live provider acceptance is claimed from simulated tests.

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
- The superseded Twilio module added migration 022, sending/receipt operations, SDK signatures, bounded retries, unknown-send quarantine and server-only settings. The local transport is replaced and migration 027 generalizes its SQL restrictions; hosted installation remains pending. Hosted 022/023 installation was reported complete on 13 October 2026; verification results remain pending.
- Historical development baseline: backend build and 80 tests passed; mobile had 73 passing tests and passed typecheck/lint/compatibility and 21 Expo Doctor checks. These results predate this provider change and do not validate Africa's Talking.
- Buyer vehicle fields are explicitly allowlisted. Deadline/result durations require administrator configuration; proposed SRS values are not treated as approved defaults.
- Migration 023, shared HTTP APIs and native app screens implement the remaining provider-independent modules, including scheduling, report evidence/history and simulated SMS/USSD.
- Hosted verification, live Auth/SMS/USSD, production payment/PIN, backup delegation, seller mandates/listing duration, real device and multi-connection acceptance remain pending. The milestone is not production-complete.
- On 21 October 2026 Africa's Talking transport/receipts, the OTP hook, inbound SMS/USSD adapters, encrypted sessions, durable replay protection and migrations 027/028 were implemented locally. Local secrets are prepared with every feature flag false. Hosted/provider configuration remains unchanged. See [setup and limits](docs/AFRICAS-TALKING-SETUP.md).
- On 22 October migration 029, owner PIN enrollment/proofs/audit, mobile PIN setup and confirmation, verified USSD PIN decisions and read-only migration preflight were added. Hosted inspection confirms 024/025 operations present and 026–029 absent; the available runtime login cannot apply SQL.
- Final local verification: backend build and 142 tests pass; mobile typecheck/lint and 93 tests pass; Expo compatibility and 21/21 Doctor checks pass; web and Android Hermes exports succeed. See [the installation handover](docs/MILESTONE2-AFRICAS-TALKING-HANDOVER.md) for files, evidence and remaining external acceptance.
