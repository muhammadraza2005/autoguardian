# Milestone 3 — Payments, subscriptions and pilot administration

## Implementation progress — 13 October 2026

Sandbox billing, pilot administration and native automatic retry components are implemented locally. Additional work on the five remaining implementation areas is recorded in [next-phase implementation and setup](docs/MILESTONE-3-NEXT-PHASE.md). Full milestone acceptance is still pending; the completion checklist below retains production/policy/device requirements.

Latest local verification: backend build and **125 tests** passed; mobile typecheck, lint and **92 tests** passed; Expo dependency compatibility and Android Hermes/web exports passed. The user reported successful hosted setup checks for migrations 024/025, and the worker login/permissions were verified previously. **Migration 026 is prepared and verified locally; it has not been applied to hosted Supabase.** Actual Android and production provider acceptance remain pending.

| Tasks | Implemented now | Remaining dependency |
| --- | --- | --- |
| 1–4 | pawaPay sandbox adapter, durable encrypted payments, status reconciliation, retry/lease recovery and configurable signed callback verification | Production onboarding; real signed callback delivery acceptance |
| 5–6 | Separate live registration form/worker, trusted revision-bound production payment receipts; sandbox paid checks and phone allowances | Live provider acceptance, approved fees/exemptions and production paid-check integration |
| 7–10 | Separate live renewals, policy-controlled entitlement decisions, SMS outbox/dispatch, snapshotted receipt identity and audited normalized statement imports | Actual benefit workflows, approved restrictions, SMS delivery tracking/acceptance, fiscal formatting and net settlement integration |
| 11–14 | Existing organization/agent controls, enrollment and incident queue links, seal allocations/count discrepancies, versioned policy/contact settings and audit history | Hosted installation, authorized accounts, physical inventory and approved operating copy |
| 15–16 | Encrypted retry recovery plus MFA-issued bounded cold-start leases and native read-only working-copy recovery | Approved offline window, editing/retention/lost-device policy and physical Android acceptance |

## Next implementation phase — items that can advance without more input

**Five of the eight remaining areas can advance now: items 4–8.** None can be called fully accepted in production until its external dependencies are resolved. This count describes areas of work, not a completion percentage.

| Item | Remaining area | Work that can proceed now | Input still needed for acceptance |
| --- | --- | --- | --- |
| 1 | Production pawaPay onboarding/configuration | Prepare configuration and validation | Business documents, merchant agreement, live credentials and enabled operators |
| 2 | Approved prices, quotas and subscription rules | Existing configuration can hold the values | Your approved fees, benefits, quotas and suspension rules |
| 3 | Real signed callback delivery | Existing signature verification can be tested locally | Enable signed callbacks in pawaPay and deliver a real callback |
| 4 | Production registration payment confirmation | Separate live payment processing and revision-bound trusted receipts | Live provider access, approved fee and production acceptance |
| 5 | Subscription benefits/access enforcement | Configurable server enforcement and ownership checks | Approved benefits and grace/suspension restrictions |
| 6 | SMS reminders/production suspension | Durable reminder delivery and policy-driven state transitions | Approved SMS copy, recipients/channel configuration and suspension policy |
| 7 | Settlement reconciliation/receipts | Audited imports, discrepancy handling and configurable receipt identity | Provider settlement exports/access and approved business receipt details |
| 8 | Cold offline startup/Android acceptance | Bounded access controls and automated recovery verification | Approved offline authorization window and physical Android acceptance |

Production payment, SMS and cold offline access remain disabled until their required configuration and policy approvals exist. No real payment or SMS was sent in this phase.

### Work added in this phase

- [x] 4. Build separate live payment records/adapter and current-snapshot production registration confirmation, with stale-payment protection and restricted worker permissions.
- [x] 5. Build policy-controlled live renewals and ownership-scoped entitlement decisions. The actual institutional lock writer remains absent, so full benefit enforcement is still pending.
- [x] 6. Build localized durable SMS reminder dispatch and server-time subscription transitions. Unknown sends are quarantined; handset delivery tracking and production acceptance remain pending.
- [x] 7. Build administrator statement imports, audited discrepancy detection and receipts with approved identity snapshots. Actual export adaptation, fees/net settlement matching and fiscal formatting remain pending.
- [x] 8. Build bounded MFA/accreditation leases and encrypted native cold-start read-only recovery. Offline editing and physical Android acceptance remain pending.

These checks record implemented slices, not completion of the eight remaining areas or the original sixteen-task acceptance checklist.

## Original objective

Integrate mobile money for registration, paid vehicle checks and subscription renewals. Complete payment confirmation, receipts, retries and reconciliation; enforce free-check allowances and subscription rules; provide basic pilot administration; and finish encrypted offline agent drafts with safe synchronization.

Based on [whatsleft.md](whatsleft.md), this milestone is broken down into **16 practical tasks**. All tasks below are required for the planned V1 Kinshasa pilot; priority determines development order. This is a planning checklist, not a claim that the existing components have been independently verified.

All payment-provider integration belongs to this milestone. Earlier registration and vehicle-check workflows retain fail-closed payment gates until trusted payment confirmations or approved allowances exist.

## Tasks in priority order

| Order | Task | Your input required | What Codex can implement independently | Requirement in the app |
| --- | --- | --- | --- | --- |
| 1 | Choose and configure mobile-money provider | Choose provider; supply sandbox/live access and account details | Integration adapter and server-side configuration, once provider details are available | Enables real payments |
| 2 | Define payment and subscription rules | Approve prices, free-check quotas, exemptions, subscription periods, grace periods and suspension rules | Configurable rules and validation | Determines who pays and when access is allowed |
| 3 | Build the shared payment workflow | Provider access from task 1 | Payment records, initiation, pending/failure screens and secure binding to the operation being purchased | Foundation for registration, checks and renewals |
| 4 | Verify callbacks and handle retries | Provider callback setup/access | Callback authentication, duplicate protection and recovery of interrupted payments | Prevents false confirmations and duplicate processing |
| 5 | Connect registration payments | Approve registration fee | Trusted payment confirmation connected to registration prerequisites | Registration remains payment-gated until this works |
| 6 | Connect paid checks and free allowances | Approve check price and allowance/exemption rules | Quota enforcement and payment integration with buyer checks | Makes the Milestone 2 journey work under real billing rules |
| 7 | Implement subscriptions and renewals | Approve packages, duration and access benefits | Subscription records, renewal payments and entitlement checks | Enables continuing paid service |
| 8 | Add reminders, grace periods and suspension | Approve reminder timing and suspension/reinstatement policy | Scheduled reminders and automatic status transitions | Keeps subscription access consistent |
| 9 | Generate payment receipts | Supply approved business details and receipt requirements | Receipts, transaction references and payment history | Gives users proof of payment |
| 10 | Build payment reconciliation | Supply provider settlement access and approve handling of discrepancies | Compare payment/settlement records and expose unresolved discrepancies | Identifies missing or mismatched payments |
| 11 | Manage agents and organizations | Approve administrator roles and accreditation/suspension rules | Account and organization controls, permissions and audit history | Supports daily pilot staffing |
| 12 | Complete administration of enrollment approvals | Prepare reviewer accounts and confirm acceptance | Connect existing approval components to administration queues | Lets administrators process registration work |
| 13 | Manage seal stock and allocations | Supply actual inventory and allocation rules; verify physical stock | Stock screens, allocations, reconciliation and audit records | Keeps physical seals accountable |
| 14 | Manage incidents and pilot configuration | Approve incident handling and editable settings/templates | Incident queues and controlled configuration screens | Supports daily operations and policy changes |
| 15 | Complete encrypted offline agent drafts | Final acceptance on Android devices | Offline startup/access behavior and draft recovery | Retains agent work when connectivity fails |
| 16 | Implement safe automatic synchronization | Confirm operational conflict rules and complete device acceptance | Durable sync, retries, duplicate prevention, conflict handling and stock reconciliation | Uploads offline work without corrupting records |

## Completion checklist

- [ ] 1. Mobile-money provider selected and configured.
- [ ] 2. Payment and subscription rules approved and implemented.
- [ ] 3. Shared payment workflow connected through database, backend and app.
- [ ] 4. Trusted callbacks, duplicate protection and retries verified.
- [ ] 5. Confirmed registration payments satisfy the payment prerequisite.
- [ ] 6. Paid checks and free allowances enforce approved rules.
- [ ] 7. Subscriptions and renewals update the correct entitlements.
- [ ] 8. Reminders, grace periods, suspension and reinstatement work.
- [ ] 9. Receipts and payment history are available to authorized users.
- [ ] 10. Reconciliation exposes discrepancies for administrator handling.
- [ ] 11. Administrators can manage agents and organizations.
- [ ] 12. Enrollment approval administration is connected and accepted.
- [ ] 13. Seal stock and allocations are manageable and auditable.
- [ ] 14. Incident queues and pilot configuration are usable.
- [ ] 15. Encrypted offline drafts survive interruptions and respect access rules.
- [ ] 16. Automatic synchronization handles retries, conflicts and stock safely.

## Input and dependency planning

pawaPay is the selected mobile-money provider, with sandbox integration first.
The four callback routes and a temporary HTTPS tunnel are prepared; see
[pawaPay sandbox callback setup](docs/PAWAPAY-SANDBOX-SETUP.md) for the URLs and restart instructions.
This bootstrap receiver records unverified callback summaries only. Provider
authentication and a sandbox deposit/status client are implemented; trusted
production business payment processing and onboarding remain pending; sandbox billing and pilot controls are now implemented;
tasks 1 and 4 are not complete merely because callback URLs exist.

The main upfront requirements are pawaPay account access and approved payment/subscription rules. Credentials belong in server-side secrets, never in client code or committed files.

Codex can build provider-independent payment infrastructure, administration and offline workflows while external access is being arranged. Live integration and acceptance depend on provider access and approved rules. Sample or simulated payments must not activate production operations.

Extend the existing enrollment approval, payment-gate, encrypted recovery and seal components after inspecting their current implementation. Their presence does not establish completion of this milestone.

## Requirements shared by every task

- Implement each workflow through the database, backend and role-based mobile app where applicable.
- Enforce tenant isolation, permissions and audit records.
- Include English/French copy and loading, empty, error, offline and expired states where applicable.
- Verify meaningful business and security cases, including unauthorized access, duplicates, retries and failed prerequisites.
- Document configuration, setup and acceptance evidence; distinguish local implementation from live provider/device acceptance.

## Milestone acceptance

Milestone 3 is achieved when confirmed payments unlock the correct operations, approved allowances and subscription rules work, administrators can manage daily pilot activity, and agents can safely save and synchronize offline work.

Payment acceptance must include successful, pending and failed payments; invalid and duplicate callbacks; interrupted requests; receipts; and reconciliation discrepancies. Offline acceptance must include interrupted startup/synchronization, repeated retries, conflicting revisions and stock reconciliation.

## Scope boundaries

Expanded billing, card integration, professional packages, revenue sharing, ownership transfers and institutional connectors are not automatically added to this milestone. Confirm any pilot requirement separately. Refund and cash-handling policy must be resolved if those operations are included in the agreed pilot payment flow.

App-wide release acceptance, performance, monitoring, backups/restore, production deployment, signed builds and publication remain in Milestone 4. Milestone-specific tests, security, audit records, bilingual copy and documentation remain required here.
