# Encrypted native enrollment recovery and sample capture

Implemented 10 October 2026. This increment supports fictional development
enrollments. It does not enable production registration or complete device acceptance.

## Implementation

- Native vehicle/seal working copies, owner fields, consent attempts, sample file
  bytes and sample review retries use authenticated AES-256-GCM records. The key
  is held in SecureStore; app-private files contain ciphertext with hashed names.
  Authenticated context binds each record to the tenant/account/role scope and
  record ID. A fresh nonce is generated for each write.
- Form recovery is restored only after a genuine server profile loads. Account,
  tenant or role changes replace the key and remove prior ciphertext. Sign-out
  locks access immediately and removes the key before file cleanup; Auth sign-out
  is attempted even if recovery cleanup fails.
- Vehicle/seal requests persist their exact retry key/body before contacting the
  server. Native owner and consent attempts are encrypted separately. Browser
  owner data and attachment/review attempts remain in memory.
- JPG/PNG/PDF sample selection and camera photos use the existing 2 MB limit.
  Temporary app-cache copies are deleted after reading, including failed reads.
  DocumentPicker/ImagePicker crash leftovers are cleaned before native recovery.
  Original external files are never deleted. Capture necessarily creates a
  temporary plaintext camera/picker file; physical-device cleanup still needs
  acceptance. This is not a claim that plaintext can never reach a cache.
- Native upload retry journals keep the original draft revision and owner
  generation. Migration 015 checks those values under a draft lock during both
  reservation and final staging. Exact retries create no extra attachment or
  binding. Changed contexts return a conflict; encrypted attempts remain until
  explicitly discarded and are never rebound to a new owner automatically.
- Native image viewing uses an in-memory data URI, with no exported plaintext
  file or sharing intent. Previews are cleared on backgrounding. Sample review
  controls become available after the image load event for the current revision.
  This UI guard is not proof of human inspection or production evidence approval.
  Review attempts are encrypted before saving and retain exact retry keys.
- Android PDF viewing now uses pinned PDF.js bundled inside an incognito WebView.
  Documents remain in memory; no external viewer, remote renderer, file export,
  WebView cache or local storage is used. Network is blocked by CSP, navigation
  is restricted, PDF scripting/evaluation is disabled, and one bounded canvas is
  rendered at a time. Previous/next controls and a page-text view are bilingual.
  Review controls require every page to render for the current revision. This
  records UI inspection, not proof of human inspection or production approval.
  Malformed, encrypted/password-protected or unsupported PDFs fail visibly;
  documents are limited to 2 MB and 100 pages.
- Submission/finalization retry keys also use the encrypted vault. See
  [submission setup and integration boundary](ENROLLMENT-SUBMISSION.md).
- Persistent native metadata uses encrypted records, not an unencrypted SQLite
  database. Existing SQLCipher plugin configuration is not used as evidence that
  a working encrypted database exists. Errors in device persistence are visible.

## Hosted setup

Hosted migrations 011–015 are confirmed. The
[migration 015](../supabase/migrations/202610100015_native_evidence_uploads.sql)
is installed and verified; do not replay it. Migration 016 for submission is
also installed and verified. Independent review migration 017 is pending;
follow the [review guide](REGISTRATION-REVIEWS.md). PDF viewing itself needs no database change.
`react-native-webview` was installed with Expo 57's compatible version. Existing
Android development builds need a rebuild to include that native module before
testing; bundle export alone does not install it on a phone.

Rebuild/restart the backend after applying it and run from `backend/`:

```powershell
node --env-file=.env scripts/verify-enrollment-setup.cjs
```

The verifier now expects 017; it exits nonzero until that setup is present.
Missing native setup leaves browser uploads available and native capture disabled.
No hosted schema changes were performed by this implementation.

## Acceptance retained for the end

Use a development Android build and fictional files only:

1. Sign in as an accredited agent. Type vehicle, owner and fitting changes; wait
   for device encryption to finish. Restart and confirm the original fields and
   ambiguous request keys recover after online profile validation.
2. Capture/select a sample file in Documents and each fitting slot. Deny camera
   permission, cancel selection and try oversized/unsupported files. Verify the
   original files remain intact and temporary app-cache files are removed.
3. Interrupt upload read-back, restart, then retry. Verify one attachment and one
   binding. Change the draft/owner on another session before retrying; verify a
   conflict, retained ciphertext and explicit discard instead of reassignment.
4. View an image, confirm sample decision controls remain disabled before load,
   save a sample decision, refresh and retry an interrupted result. Backgrounding
   clears the preview and inspection state. Open a multi-page PDF, navigate every
   page and verify review stays disabled until all render. Test malformed,
   password-protected and oversized PDFs; background/close/sign-out must unmount
   the viewer. Verify no PDF file or WebView cache survives and no network renderer
   is contacted. Test rotation/text scaling, page text and French controls.
5. Change accounts/roles, revoke accreditation and sign out during encryption or
   capture. Inspect app-private storage: committed records contain ciphertext;
   a failed cleanup cannot expose another account's recovered forms.
6. Verify English/French, narrow screens, touch/keyboard and accessibility.
   Submission and activation must remain disabled.

## Remaining work and limits

PDF rendering is implemented; physical-device acceptance remains pending.
Full offline startup/access policy, automatic durable sync scheduling and stock
reconciliation belong to Milestone 3. This implementation
preserves interrupted work but requires online server identity checks; it does
not authorize offline enrollment. No device acceptance is claimed from bundle
exports or Node crypto tests. Native AES, SecureStore, camera/file permissions,
crash recovery and plaintext cache cleanup must be checked on a real device.

Production login, independent reviewer permissions/policy, authenticated consent,
production seal issuance/placement/inspection, configured payment integration and
the trusted receipt producers remain separate work. Atomic vehicle/ownership
finalization is implemented but gated; see the submission guide. SMS and owner OTP integration
were moved to Milestone 2 by the project owner. Activation continues to require
verified owner identity; sample acknowledgments are not a bypass.

SDK API references checked against the installed Expo 57 major version:
[Crypto](https://docs.expo.dev/versions/v57.0.0/sdk/crypto/),
[FileSystem](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/),
[SecureStore](https://docs.expo.dev/versions/v57.0.0/sdk/securestore/),
[ImagePicker](https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/) and
[DocumentPicker](https://docs.expo.dev/versions/v57.0.0/sdk/document-picker/).

PDF references: [Expo 57 WebView](https://docs.expo.dev/versions/v57.0.0/sdk/webview/),
[WebView properties](https://github.com/react-native-webview/react-native-webview/blob/master/docs/Reference.md)
and [PDF.js rendering examples](https://mozilla.github.io/pdf.js/examples/).
Regenerate the checked-in public renderer after updating the pinned PDF.js:
`node scripts/build-pdf-viewer.cjs` from `mobile/`. Its Apache-2.0 license notices
are retained; no document bytes enter the generated file. Tests execute that same
bundle against real vector PDF pages on Node canvas, not an Android WebView.
