# Pilot administration

Migration `202610130025_pilot_administration.sql` and the `/v1/pilot-administration`
API add daily operations for existing tenant organizations and agent accreditations,
seal allocation, physical counts, versioned operational configuration and immutable
audit history. The mobile screen is `/pilot-administration`, linked from live account.

Every read and write requires a current active tenant administrator assignment and
a verified, recent password/TOTP MFA session. Database functions repeat this check.
A dedicated non-login executor uses tenant RLS; app clients have function execution
only, with no direct table access. The API does not create accounts or grant roles.
Agent status changes affect accreditation, not the user's consumer account. Tenant
administrator accreditations are protected from these agent operations.

## Daily operations

1. Open Pilot administration with the authorized staff account.
2. Organizations: review the reference and current status before activating or
   suspending. A reason and matching revision are required.
3. Agent accreditations: activate, suspend or revoke an existing accreditation.
   Activation requires the existing enrollment role, a currently valid accreditation
   interval and an active organization/user.
4. Seal inventory: move an unallocated in-stock seal to an accredited agent and
   organization. Reserved, active, revoked and destroyed seals cannot be moved.
   Production seals with any previous placement cannot be reassigned or counted as
   available, including after that placement is released. This does not issue or
   fabricate physical seals. Use the existing enrollment
   approval screen's batch issuance with actual stock confirmations for issuance.
5. Organizations → Record physical count: choose production/development origin,
   count physically available unallocated seals and give a reason. The server records
   the expected count and discrepancy without silently changing stock.
6. Configuration: supply incident handling policy in both languages and an optional
   approved emergency contact. No configuration is seeded; approval defaults false.
   Each save creates a new revision. This record does not enable registration,
   payment collection, automated report decisions or any legal/institutional action.
7. Enrollment approvals links to the existing independent review workflow. Incident
   review links to the existing Reports screen; choose its reviewer queue to review
   submitted reports. These use the existing report APIs/evidence/history, rather
   than a second incident store.
8. Payment/subscription rules links to the separate billing configuration workflow.
9. Audit history shows performed changes and recorded stock discrepancies.

Existing user/organization creation, tenant administrator provisioning and enrollment
role assignments remain controlled provisioning operations. Do not grant users an
administrative role through client metadata or the section picker.

## Failure and concurrency behavior

Reads are bounded and paginated, contain references rather than owner identity or
alarm placement locations, and have no persistent query cache. Write requests carry
an idempotency key, target and expected revision. Repeating the same request returns
the original result; reusing a key with another payload conflicts. Stale revisions
and concurrent serializable writes require refresh. A lost response keeps the same
attempt in memory and exposes Retry the same change. Do not create another operation
until that attempt is resolved; after app restart, inspect audit history first.

Physical reconciliation locks existing stock for a consistent transaction snapshot;
concurrent stock activity can produce a serialization conflict rather than a false
confirmation. A discrepancy needs operational investigation and an approved stock
correction policy. The system records evidence, never assumes an observed count is
proof that missing physical seals should be created or silently destroyed.

## Verification and acceptance

Local PGlite tests apply every migration and exercise real database functions with
verified-session fixtures: authorization/MFA, tenant restrictions, revision conflicts,
duplicate requests, immutable history, configuration and stock discrepancies. Run:

```powershell
cd backend
npm.cmd run build
node --test tests/pilot-administration.test.cjs
```

Mobile typecheck/lint establish source compatibility. Live Supabase installation,
authorized staff accounts, real inventory counts, policy approval and Android
visual/device acceptance are separate acceptance steps; this document does not
claim those external steps have been completed.
