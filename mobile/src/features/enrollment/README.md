# Enrollment module
Gemini implements the role-scoped UI from frontend.md section 6. Native dependencies are installed, not an implemented offline system.
SQLCipher is enabled in Expo config. Do not open a database without generating/protecting a random key and verifying cipher support.
The live development browser now saves synthetic drafts, owner choices, encrypted sample attachments, and provisional seal fittings through the restricted backend. See `docs/DEVELOPMENT-SEAL-FITTING.md` for the latest setup and test procedure. Signed-in upload/download testing succeeded for the earlier sample upload increment.
Native offline database/file encryption, durable sync and production authentication remain pending. Use synthetic data only; the design preview stays separate and in memory. Never label a draft enrolled or protected merely because a fitting draft is complete.
