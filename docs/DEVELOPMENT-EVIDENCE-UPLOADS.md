# Development document and photo uploads

The original staging guide below describes migration 007. The current wizard
requires migrations through 011 and uses the [detailed eight-item checklist](DEVELOPMENT-EVIDENCE-CHECKLIST.md),
with a registration/purchase alternative, six named photo requirements and a
30-file limit per current owner generation. Follow that guide for current acceptance.

This increment stages **synthetic sample files only**, using temporary development email authentication. It does not verify identity, clear malware, grant ownership, process payment or activate enrollment. Phone OTP remains deferred at the user's request. Production agent factors, real identity capture, native encrypted offline storage and production key management remain pending.

## Supabase setup

Migrations 001–006 and the agent/owner development setup must already have succeeded. Run these two new files once, as `postgres`, in the development SQL Editor:

1. [007: enrollment attachments](../supabase/migrations/202610060007_enrollment_attachments.sql). Expect success/no returned rows.
2. [Development evidence bucket](../supabase/setup-development-evidence-bucket.sql). Expect bucket `development-enrollment-evidence`, `public=false`, size limit `2097216`, and MIME allowlist `{application/octet-stream}`.

The bucket stores ciphertext, so its allowed MIME type is deliberately not PDF/JPEG. A restrictive client policy prevents unrelated broad Storage policies from granting access to this bucket. Existing public evidence buckets are refused, not silently converted. No existing documents, vehicles, owners or drafts are deleted. These scripts do not modify Supabase Auth or database passwords.

## Server configuration

The local backend environment has a labelled `SUPABASE_STORAGE_SECRET_KEY=` field and a generated `ENROLLMENT_EVIDENCE_KEY_HEX`. Add the project's **secret** API key, starting with `sb_secret_`, to the storage field. Find it in Supabase's project API Keys settings. Do not use the publishable key or database password. Do not send the secret into chat or copy it to any mobile/public environment variable.

The helper can prepare missing settings without replacing credentials:

```powershell
cd backend
node --env-file=.env scripts/prepare-evidence-env.cjs
```

Restart the backend after editing the environment. Keep the generated encryption key in a protected backup: changing or losing it prevents recovery of existing encrypted files. This is development key handling, not a production rotation/KMS design. Missing credentials leave the UI unavailable; the API never pretends an upload succeeded. The privileged Storage client is isolated in the backend object adapter; domain operations still use the restricted PostgreSQL login and RLS, never the secret key.

## App verification

1. Restart **Start Backend.cmd** and **Preview Live Login.cmd**, or refresh the already restarted preview after configuration.
2. Open `http://localhost:8081`, sign in with the development email account, and choose **Development enrollment drafts** from the connected account. Use the live login preview rather than the design preview.
3. Choose **Upload documents and photos** on a saved draft card. The same button is at the top of its edit screen. New drafts must first be saved; save returns to the list. Save any edits before leaving the edit screen.
4. On the dedicated **Draft documents and photos** page, choose **Add sample identity document** or **Add sample vehicle photo**, then select the matching JPG from `.tools/upload-samples/` in the project. Registration samples can also be added. Identity/registration samples may be JPG, PNG or PDF; photos must be JPG or PNG. Maximum input size: 2 MiB; maximum attachments per current draft/owner: 10, including unconfirmed reservations.
5. Only after server confirmation should the item show **Saved for review — not approved**. Return to the drafts list, reopen **Upload documents and photos**, and confirm it remains listed.
6. Use **Download sample for review** to verify authorized, audited recovery. It downloads a generic filename, never a public/signed URL.
7. For an ambiguous upload, retry the same payload/key. Refresh can show whether the server already completed it. Different content cannot reuse a request key.

The first picker is available in the development **browser only**. Native buttons remain unavailable until local attachment encryption and account isolation are verified. Browser-picked files remain in memory; the app does not copy them to a native cache, create offline draft files, persist file bytes in query caches or retain original filenames. Explicit sample downloads are user-directed browser downloads.

## Security and lifecycle

- Draft access, tenant, agent grant, current organization accreditation and proposed owner eligibility are validated in the database. Other agents cannot list/read attachments, even within the same organization.
- JPEG/PNG inputs are decoded with pixel limits, resized/re-encoded and stripped of EXIF/GPS and other metadata. Arbitrary MIME declarations and original filenames are not accepted from the client.
- PDF handling screens signatures, the end marker and obvious active content. It is not a complete PDF parser or antivirus scanner. All objects remain **STAGED**, never approved; use only synthetic files until full evidence validation and production authentication are completed.
- AES-256-GCM encryption happens before Storage receives bytes. A random 96-bit nonce and authentication tag protect each object. Authenticated context binds tenant, draft, proposed owner, attachment ID, kind, MIME type, size and hash. Objects have opaque UUID paths and a versioned `AG01` format.
- The server checks the bucket is private and matches the size/MIME configuration. Uploads never overwrite an existing object. Read-back/decryption/checksum verification must succeed before metadata becomes STAGED. Retries recover lost responses without double creation.
- Changing a draft's proposed owner hides the prior owner's evidence and prevents it being downloaded under the new owner. Old objects remain retained for future authorized cleanup/review; no automatic deletion is introduced.
- Metadata/events have forced RLS and no direct client, service-role or API-role table access. Only reviewed restricted executor functions can write them. Upload reservation/completion and reasoned reads append events. A read request is logged before object retrieval; it does not claim the client received the file.
- No temporary URLs or file bytes are returned to consumer vehicle endpoints. No new core owner/ownership/vehicle records are created. Missing/revoked access, tampering, wrong keys, wrong scope and storage failures cannot return file bytes or successful enrollment.

## Verification limits and production prerequisites

On 6 October 2026, `node --env-file=.env scripts/verify-evidence-setup.cjs` passed against the hosted development project. It verified secret/key configuration without printing values, certificate-verified database TLS, the restricted database role, forced attachment RLS/function grants, the restrictive Storage client policy and private bucket settings. A synthetic JPEG was encrypted, uploaded, downloaded/decrypted and compared successfully; anonymous authenticated-endpoint and public-endpoint downloads were denied. The generated probe object was removed. The backend was restarted with the updated credentials and its health endpoint passed.

This probe did not create an enrollment attachment record, authenticate through the mobile UI, prove provider disk/backup encryption or exercise native on-device storage. The next acceptance check is a signed-in browser upload/list/download through an existing draft. The reusable verifier creates/removes only its own random synthetic object and never changes domain data.

Tests use isolated PGlite, synthetic images/PDF bytes and an in-memory Storage adapter. They prove the application cipher, retry lifecycle, access policies and bucket SQL behavior; they do not prove execution against the hosted Storage service, provider infrastructure encryption/backups, native file encryption or production readiness. Hosted verification requires the SQL and backend secret above, then a synthetic upload/download round trip. Verify provider/database/object/backup encryption under the selected deployment before collecting real identities, as required by `mobile/AGENTS.md`.

Production still needs agent password/OTP or the approved factors, upload rate/concurrency limits, full malware/content validation, evidence retention/abandonment and reservation cleanup, protected key rotation/recovery, sensitive access tracing and the full audit chain. Database backups do not contain Storage object bytes: object and key recovery must be tested together. Owner OTP, seal fitting, payment and final review/activation remain separate enrollment steps.

References: [Supabase server-only keys](https://supabase.com/docs/guides/getting-started/api-keys), [Storage access controls](https://supabase.com/docs/guides/storage/security/access-control), [Node authenticated encryption](https://nodejs.org/api/crypto.html), [sharp output/metadata behavior](https://sharp.pixelplumbing.com/api-output/), [Expo SDK 57 DocumentPicker](https://docs.expo.dev/versions/v57.0.0/sdk/document-picker/).
