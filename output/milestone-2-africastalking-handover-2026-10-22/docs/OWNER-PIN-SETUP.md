# Owner PIN enrollment and action proofs

Implemented locally on 22 October 2026. Apply migration
[029](../supabase/migrations/202610220029_owner_pin_step_up.sql) after 028, then
run the [read-only verifier](../supabase/verify-owner-pin.sql). All nine results
must be true. Nothing in this migration seeds or enables a PIN policy.

## Implemented behavior

- Owner PINs contain 4–6 digits, as required by the SRS. The backend stores an
  independently salted scrypt hash (`N=32768`, `r=8`, `p=1`, 32-byte output),
  never the chosen PIN. Credentials and staged enrollment are forced-RLS/private.
- Initial enrollment requires an existing verified owner account, a current app
  session and a fresh SMS code sent through Africa's Talking. The code expires
  after three minutes, allows five attempts and is bound to the same account,
  phone and app session. No credential is installed before confirmation.
- PIN attempts reserve an attempt atomically before hash verification. Incorrect
  attempts and interrupted attempts cannot bypass the configured lockout.
- Successful verification issues a short-lived opaque proof. The database stores
  its hash and binds it to the current owner, phone, session and exact action.
  Check proofs include request and decision. Sale proofs include vehicle,
  idempotency key, previous/new status and reason.
- Proof consumption and the business write share a transaction. Reuse, changed
  actions, changed phones, expired proofs and revoked sessions fail closed.
  Legacy decision/sale functions are no longer callable by the runtime login.
- PIN enrollment, failures, proof issuance/consumption and policy changes append
  privacy-safe audit events. Events contain no PIN, OTP, credential hash or token.
- The app includes Owner PIN setup, explicit approval/refusal PIN confirmation,
  and PIN entry for listing/unlisting. PINs/codes/proofs are not stored in offline
  drafts, query caches or route parameters. Inputs clear on background/navigation.
- When both channel and PIN support are enabled, USSD asks for the owner PIN after
  choosing the decision and request reference. It shares the same credential,
  lockout and one-use proof rules. Raw cumulative input is not persisted/logged.

Ordinary SMS never accepts a reusable PIN. With PIN policy enabled, an SMS-only
decision cannot bypass the gate: use the app or verified USSD PIN flow. Production
basic-phone identity/recovery and a secure SMS challenge policy still need client
acceptance. No channel can satisfy staff MFA or general Supabase session proof.

## Configuration

1. Complete [Africa's Talking setup](AFRICAS-TALKING-SETUP.md), including controlled
   recipients, trusted ingress and the independent telecom encryption/HMAC key.
2. Set `OWNER_PIN_ENABLED=true` only in the intended configured environment.
   This exposes the PIN endpoints and adds PIN support to the USSD adapter.
3. A current MFA-authenticated TENANT_ADMIN reads/writes
   `GET/PUT /v1/administration/owner-pin-policy`.
4. Supply all required policy fields explicitly:

| Field | Accepted value |
| --- | --- |
| `enabled` | Boolean; enable only after policy acceptance. |
| `maxAttempts` | Integer 1–10. |
| `lockSeconds` | Integer 30–86400. |
| `proofSeconds` | Integer 15–300. |
| `approvalReference` | A recorded policy approval reference, 3–200 characters. |

No operational defaults or administrator policy were selected for the client.
The allowlisted test environment can use clearly labeled synthetic approvals.
Disabling this policy does not enable production checks: the existing synthetic
check and production billing gates remain separate.

## API and app flow

| Method/route | Payload/result |
| --- | --- |
| `GET /v1/me/owner-pin` | Policy/configuration/phone-current/cooldown booleans only. |
| `POST /v1/me/owner-pin/enrollments` | `{pin}`; returns `{challengeId}` after SMS acceptance. |
| `POST /v1/me/owner-pin/confirm` | `{challengeId,code}`; returns `{configured:true}` only after server confirmation. |
| `POST /v1/me/owner-pin/proofs` | `{requestId,decision,pin}` or `{vehicleId,requestKey,expectedStatus,saleStatus,reason,pin}`. |
| Existing owner decision route | Submit `{decision,proof}` after choosing the answer and verifying PIN. |
| Existing sale-status route | Add `proof` to the existing body; reuse the exact request key and sale values used for the proof. |

Account → **Owner PIN** provides setup. Owner inbox and sale screens request PIN
proof only when the server reports its policy enabled. Server enforcement remains
authoritative; a hidden/absent client PIN control never grants authorization.

## Limits and acceptance still required

This implements initial setup and check/sale step-up. PIN reset/replacement is
deliberately unavailable until the identity-recovery policy is agreed. Existing
credentials cannot be overwritten through enrollment; phone changes invalidate
them and require assisted recovery. Ownership transfer is a separate later flow.

Synthetic tests pass for hashing, OTP confirmation, lockout, one-use proofs,
changed actions/phones, USSD OTP-plus-PIN and role restrictions. Actual SMS,
handsets, accessibility/keyboard behavior, concurrent PostgreSQL load and independent
security review still need acceptance. Backup-contact delegation, seller mandates
and automatic listing expiry are not implemented by the PIN module.
