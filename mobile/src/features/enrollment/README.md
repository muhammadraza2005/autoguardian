# Enrollment module

Current seal increment requires migration 012. Seals supports stock choices,
QR/manual development codes and read-only server checks before saving. Seals and
Review share per-position diagnostics; duplicate image content cannot fill two
entries. Scanner preview stops on scan/close/blur/background and manual entry
remains available after permission denial. See `docs/DEVELOPMENT-SEAL-VALIDATION.md`.
Physical positions/authenticity remain unverified; this is a development record.
Gemini implements the role-scoped UI from frontend.md section 6. Native dependencies are installed, not an implemented offline system.
SQLCipher is enabled in Expo config. Do not open a database without generating/protecting a random key and verifying cipher support.
The live development browser now saves synthetic drafts, owner choices, encrypted sample attachments, and provisional seal fittings through the restricted backend. See `docs/DEVELOPMENT-SEAL-FITTING.md` for the latest setup and test procedure. Signed-in upload/download testing succeeded for the earlier sample upload increment.
The connected development flow now runs in the designed agent shell at `/agent`,
with Vehicle, Owner, Documents, Seals and Review steps. Legacy development URLs
redirect to the matching step. Progress comes from saved readiness, never merely
from opening a screen. Owner details and sample consent use the same server APIs;
unsaved identity fields remain only in memory. See
`docs/CONNECTED-ENROLLMENT-WIZARD.md` at the repository root.

Native offline database/file encryption, durable sync and production authentication remain pending. Use synthetic data only; the disconnected design preview remains development-only and in memory. Never label a draft enrolled or protected merely because a fitting draft is complete.

Documents and Review now share a server-calculated eight-item evidence checklist:
owner ID, registration or purchase proof, front/rear/left/right views, chassis and
plate photos. Migration 011 is required. Pending uploads and earlier generic
photos do not complete the named requirements. See
`docs/DEVELOPMENT-EVIDENCE-CHECKLIST.md` for setup, limits and acceptance.
