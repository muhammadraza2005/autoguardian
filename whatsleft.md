# AutoGuardian — What's built and what's left

Status reviewed: **10 October 2026**.

For milestone 1's completion estimate, detailed checklist and next-session
context, read [milestone-1.md](milestone-1.md).

Based on the original Software Requirements Specification, the agreed single-app plan, and the current local code. This checklist records implementation status; a preview screen does not mean its real operation is complete.

## Current position

The mobile interface, backend/database foundation, development authentication, owner vehicle reads and connected five-step enrollment preparation flow are in place. Production registration, buyer verification, messaging, payments and pilot operations still need development. Development samples cannot submit or activate a vehicle.

**V1 pilot planning estimate: approximately 30% implemented and 70% remaining (25–35% complete range).** This is a judgment based on working functionality, integrations and acceptance requirements, not a measured percentage or a delivery commitment. Visual UI progress is further along than production functionality.

The four milestones below are the working plan for the upcoming development. Build each workflow through the database, backend and mobile app together. Include tests, security, audit records, French/English copy and documentation in each milestone.

## Already built

- [x] One Expo / React Native app with consumer, agent, institutional, and administration sections.
- [x] Stitch-based navy headers, navigation, cards, forms, buttons, and bundled Public Sans font.
- [x] Welcome, phone/OTP, consent-preview, and PIN-setup screens.
- [x] Consumer check, fee, payment-preview, waiting, and outcome screens.
- [x] Owner vehicle list/detail, authorization/PIN, alerts, and listing-preview screens.
- [x] Agent enrollment list, five-step wizard UI, seal-installation panel, and stock screens.
- [x] Institutional lookup, access-reason, clearance, token-preview, and incident panels.
- [x] Administration dashboard, user search, and account/section-preview screens.
- [x] English/French resources for the new screens and shared navigation.
- [x] Development preview identities and section-navigation guards.
- [x] API request helper, optional Supabase client setup, and native session-storage adapter.
- [x] NestJS identity/profile, owner vehicle reads and development enrollment APIs.
- [x] Twenty-three database migrations in source, tenant isolation, restricted roles, RLS and scoped audit. Hosted 019 and 021 are reported verified; 020's earlier installation status is not independently established here. New SMS/workflow migrations 022?023 await hosted installation. See [Milestone 2 handover](docs/MILESTONE2-HANDOVER.md).
- [x] Connected development enrollment drafts, encrypted sample owner details/consent, browser sample evidence and provisional seal fitting with QR/manual checks.
- [x] Hosted development migrations 011–012 and encrypted private Storage round-trip/access denial verified.
- [x] Saved four-slot development seal location descriptions with revision conflicts, retries, stale-data hiding and English/French form/review controls. See [setup and acceptance](docs/DEVELOPMENT-SEAL-LOCATIONS.md).
- [x] Development evidence self-review in the browser: sample downloads, acceptable/correction decisions, fixed reasons, append-only history, exact retries and revision invalidation. Production approval remains pending. See [setup and acceptance](docs/DEVELOPMENT-EVIDENCE-REVIEWS.md).
- [x] Encrypted native vehicle/seal/owner recovery, attachment/review/submission retry journals, camera/file selection and image/PDF viewing. Automated PDF rendering checks pass; physical-device acceptance remains pending. See [native guide](docs/DEVELOPMENT-NATIVE-EVIDENCE.md).
- [x] Submission/finalization component with trusted prerequisite checks, duplicate protection, atomic vehicle/ownership/audit writes and owner-only reads. Hosted 016 is installed. Samples cannot activate; remaining trusted integrations are required. See [setup](docs/ENROLLMENT-SUBMISSION.md).
- [x] Independent authority review, correction/replacement, audit history, agent feedback and trusted review confirmations under the approved TENANT_ADMIN policy. 017 is required by verified 019; see [setup](docs/REGISTRATION-REVIEWS.md).
- [x] Password/TOTP staff authentication, live session/factor revocation checks, production draft entrypoint and direct owner consent/withdrawal with immutable bilingual versions and trusted access receipts. 018 is required by verified 019; real approved wording still requires replacing delegated placeholders; see [exact setup](docs/AGENT-ACCESS-CONSENT.md).
- [x] Latest integration checks: backend build and 58 tests; mobile TypeScript/lint and 68 tests; exact test-pack PDFs parsed/rendered. The earlier baseline passed 123 database foundation checks. Offline dependency compatibility passed with its reliability warning.
- [x] Web and Android Hermes bundles exported successfully.

**Still to verify:** signed-in browser/camera interaction, French wrapping, keyboard/accessibility behavior and Android device acceptance. Phone testing was deferred by the project owner. Bundle exports do not establish native encryption or release acceptance. See [the verification report](docs/ENROLLMENT-VERIFICATION-2026-10-10.md).

## Remaining development

| Area | Current status | What's left |
| --- | --- | --- |
| Frontend | Main layouts and interactive previews built | Missing business workflows; complete validation; loading, empty, error, offline, expired, and permission states; accessibility and device checks. |
| Backend | Connected enrollment, signed seals, independent review and development Milestone 2 checks, decisions, schedules/retries and reports implemented | Production payment/step-up and provider gates; billing, transfers, delegated workflows and institutional clearances. |
| Database | Foundation and development enrollment migrations/RLS implemented | Remaining domain tables, workflow transitions and policies; complete audit coverage, production configuration and backup/restore. |
| Authentication | Live-session checks, staff MFA, role loading and provider-backed phone OTP screens implemented | Live phone provider/OTP acceptance, assisted phone recovery and production owner PIN/step-up. |
| Payments and billing | Simulated payment UI | Mobile money/card providers, verified callbacks, quota/exemption rules, subscriptions/installments, receipts, refunds, reconciliation, professional packages, and revenue sharing. |
| Notifications | Durable outbox, reminders, bounded retries/receipts and held backup schedules | Live SMS acceptance, accepted backup contacts/delegation, push and other configured channels. |
| Owner operations | Connected development inbox, decisions, missing/recovery, sale listing/removal and history | Production PIN/step-up, listing duration/expiry, subscriptions and device acceptance. |
| Delegation | Account entry points only | Backup invitations/acceptance/removal, seller mandates/acceptance/revocation, expiry, and scoped permissions. |
| Ownership transfer | Not implemented | Buyer invitation/OTP, identity review, seller confirmation, registry handling where configured, completion/refusal, and removal of former-owner access. |
| Agent enrollment | Connected five-step development wizard, saved drafts, encrypted sample identity/evidence, sample consent, packages, fitting and readiness | Production agent login, owner OTP/consent, native evidence capture, evidence/physical review, confirmed payment, submission, authority approval, activation and assisted phone changes. |
| Offline operation | Browser working copies and encrypted native form/file/review recovery with revision-bound retries | Full offline startup/access policy, automatic durable sync, stock reconciliation and device acceptance. |
| Seals | Development assigned stock, QR/manual codes, reservations and fitting diagnostics | Production issuance/allocations, signed identifiers, placement rules, physical inspection, replacement/revocation and lost/damaged handling. |
| Institutional operations | Registry/clearance previews | Separate police, registry, and insurer scopes; logged identity access; owner consent; real clearance issuance/refusal/expiry/consumption; missing reports; inspection and incident workflows. |
| Administration | Sample dashboard and user search | Organizations/accounts, accreditation/suspension, enrollment reviews, stock allocation, configuration/templates, incident queues, financial operations, audits, support procedures, and filtered CSV/PDF reports. |
| SMS/USSD | Shared parser and simulated menus/adapters; outbound SDK/receipts implemented | Live inbound provider/session authentication, client configuration, USSD provisioning and handset acceptance. |
| Institutional API/connectors | Planned only | Partner authentication/scopes, API contracts, webhooks, DGI/police/insurer adapters, and locks activated only when agreements permit. |
| Production release | Development checks only | Meaningful business/security tests, entry-level Android testing, performance, monitoring, recovery, signed builds, store publication, technical documentation, and bilingual role guides. |

## Four milestones for the V1 Kinshasa pilot

### Milestone 1 — Finish vehicle registration: start here now

Build on the existing backend, database and enrollment wizard. Complete login/agent permissions, authenticated consent, document/photo handling, production QR seals, independent review and gated vehicle activation. All payment-provider integration is deferred to Milestone 3 by the project owner. Connect these to the agent app and owner vehicle list. SMS and owner phone OTP integration are assigned to Milestone 2 by the project owner; verification hooks remain part of the activation prerequisites. Real registration stays gated until every required identity, consent, evidence, seal, payment and review check is satisfied. Manual browser/device acceptance is retained for the end.

Registration integration and the exact synthetic upload folder are prepared. Follow [setup and manual acceptance](docs/PRODUCTION-REGISTRATION-SETUP.md). Payments remain Milestone 3 and phone proof Milestone 2.

#### Remaining work strictly within Milestone 1

| Registration work | Implementation remaining | Manual input or acceptance |
| --- | --- | --- |
| Agent access and owner consent — component implemented | Password/TOTP, current-session and role checks, production entrypoint, owner acceptance/withdrawal and trusted access receipts built | 018 is a prerequisite of installed/verified 019. Replace delegated placeholder legal facts and approve final wording before production. Apply 020 and private storage setup using docs/PRODUCTION-REGISTRATION-SETUP.md. SMS/OTP is Milestone 2. |
| Registration evidence — implementation done | Android document/photo handling, PDF viewing, encrypted recovery and automated checks implemented | Phone acceptance remains at the end; approved evidence standards belong to the review task. |
| Registration seals — backend component implemented | Signed batch issuance, assigned IDs, SRS OTHER/approved-location validation, independent MFA inspection, revocation and atomic stock consumption built; 019 installed with all verification results true, reported by the project owner | Local test signing keys and a reserved placeholder origin are prepared; replace the origin before production. Manufacture/print actual labels and do final physical acceptance. Provisional locations cannot pass. Wizard/storage and administrator controls are connected; apply 020. [Guide](docs/PRODUCTION-REGISTRATION-SEALS.md). General stock administration/reconciliation is Milestone 3. |
| Registration approval — implementation done | Independent TENANT_ADMIN reviewer access, corrections/replacements, approval, audit and trusted review confirmations implemented; actual seal confirmation comes from the seal task | Reviewer policy approved by the project owner. 017 is a prerequisite of installed/verified 019; prepare a separate reviewer account and test at final manual acceptance. General administration is Milestone 3. |
| Submission and owner visibility — component done | Prerequisites, snapshot checks, duplicate protection, atomic vehicle/ownership/audit writes and owner reads implemented; remaining tasks must supply trusted confirmations | Migration 016 installed and verified; final signed-in browser/Android acceptance remains at the end. |

Full offline startup, automatic durable sync and stock reconciliation are excluded
from this milestone and retained in Milestone 3. App-wide release acceptance,
monitoring, performance, backup/restore, deployment and store publication remain
Milestone 4. Registration-specific tests, permissions, audit records and bilingual
copy are required here. Existing development sample features are preparation,
not completed production registration.

### Milestone 2 — Make vehicle checks and owner responses work

Connect SMS delivery and owner phone OTP verification deferred from Milestone 1, then connect the consumer app so a buyer can check a vehicle by plate, chassis number or QR code. Show its permitted status information, send the owner an alert, accept a secure approval or refusal and return the result to the buyer. Add response deadlines, backup alerts, incident reporting, missing-vehicle reports and sale-status changes. Connect SMS and USSD so basic-phone users can perform the supported checks and responses. This milestone is achieved when the complete buyer-check-to-owner-response journey works, including refusal, timeout and expired results.

### Milestone 3 — Add payments, subscriptions and pilot administration

Integrate mobile money for registration, paid checks and subscription renewals, including confirmed callbacks, receipts, retries and reconciliation. Implement free-check allowances, subscription reminders, grace periods and suspension rules. Build basic administration for agents, organizations, enrollment approvals, seal stock, incidents and configuration. Complete encrypted offline agent drafts and safe synchronization. This milestone is achieved when payments control the correct operations and administrators can manage daily pilot activity. All payment-provider integration belongs to Milestone 3, including registration and paid checks. Earlier milestone flows retain fail-closed payment gates until trusted provider confirmations exist.

### Milestone 4 — Make the app ready for the Kinshasa pilot

Finish French and English coverage, verify security controls and audit logging across all workflows and test the complete journeys on Android and through SMS/USSD. Test provider failures, performance and recovery; set up monitoring, alerts, automated backups and a proven restore procedure. Prepare production deployment, signed app builds, technical documentation and user/operations guides. This milestone is achieved when the agreed pilot scenarios pass and the team can launch, monitor and support the service.

## What to do in the upcoming days

- [x] Confirm hosted development migrations 011–013 and restricted function privileges by read-only inspection.
- [x] Confirm hosted migration 014, review table forced RLS, append-only executor grants, denied client access and review policies. Do not replay 011–014.
- [x] Install development migration 015 and verify bound native upload setup. All read-only setup checks pass; do not replay installed migrations.
- [ ] Install migration 016 once and run the updated read-only verifier; follow [SQL Editor instructions](docs/ENROLLMENT-SUBMISSION.md).
- [ ] Check signed-in sample evidence reviews, draft/owner invalidation and bilingual layouts.
- [ ] Resume Android and signed-in browser acceptance of the existing wizard; fix reproduced issues.
- [x] Implement the registration seal backend from SRS rules and delegated defaults: signed issuance, actual-location/inspection checks, revocation and atomic consumption. Backend: 56 tests passed.
- [x] Apply 019: project owner reports every hosted verification result true. Do not replay it.
- [ ] Configure actual seal signing origin/key ring; complete production wizard/storage wiring and final physical acceptance. [Instructions](docs/PRODUCTION-REGISTRATION-SEALS.md).
- [x] Resolve authority review and staff factor choices: independent TENANT_ADMIN and password/TOTP.
- [ ] Publish real registration consent after supplying organization/authority/contact/retention details; apply 018.
- [ ] Select SMS/USSD and mobile-money providers and obtain sandbox access; arrange the USSD code.
- [ ] Implement milestone 1 through the database, API and mobile app, with tests for duplicates, permissions, retries and prerequisite failures.

SMS/phone OTP integration is moved to Milestone 2 by the project owner. Manual browser/device acceptance is retained for the end; continue independent implementation first. No payment provider has been selected. Owner verification still gates real activation; sample consent and unconfirmed payment are not production approval. Dates should be assigned after provider access, pilot rules and team capacity are confirmed.

## What we can build and what needs external input

We can implement the frontend workflows, backend, database, permissions, offline storage, integration adapters, tests, and deployment setup.

The following still need project-owner decisions or external access:

- [ ] SMS/USSD, mobile-money, card, and other messaging provider choices, accounts, credentials, and costs.
- [ ] USSD code allocation and basic-phone access arrangements.
- [ ] DGI, police, and insurer agreements, API access, and connector documentation.
- [ ] Final prices, revenue splits, quotas, deadlines, validity periods, review rules, and cash policy.
- [ ] Clarification of backup-contact sale approval, grouped requests, and secure SMS/USSD authorization rules.
- [ ] Approved terms, consent text, emergency contact, hosting/data-location requirements, and retention policy.
- [ ] Pilot area, release accounts, and final acceptance criteria.

## Scope used for this estimate

The four milestones cover the stated **V1 Kinshasa pilot scope**: backend/database, authentication/permissions, enrollment and verification, agent/consumer mobile functions, vehicle statuses, buyer checks, owner alerts, incidents, QR seals, SMS/USSD, mobile money, subscriptions, basic administration, French/English, security, audit, testing, monitoring, backups and technical documentation.

The broader remaining-development table also retains full-product requirements such as ownership transfers, advanced institutional clearances/connectors and expanded billing. These are not automatically added to the pilot milestones; confirm any pilot need separately.

One **Android-first mobile app**, with consumer, agent, institutional and administration functions inside role-based sections. Separate desktop portals and a later iOS release are not included in this V1 estimate.

The supplied Stitch exports remain visual references. Existing planning documents remain the detailed requirements sources.
