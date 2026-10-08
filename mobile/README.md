# AutoGuardian mobile foundation

The development enrollment flow now uses the original agent header, bottom tabs,
cards and five-step wizard at `/agent`: Vehicle, Owner, Documents, Seals and Review.
Its forms use the existing backend APIs and saved readiness; old
`/live-enrollments` links redirect to the corresponding wizard step. The separate
synthetic preview remains available in demo mode. See the
[connected wizard guide](../docs/CONNECTED-ENROLLMENT-WIZARD.md).
No new migration is needed for this UI integration. Phone OTP remains deferred.

The latest enrollment increment adds **Owner details and sample consent** to
connected drafts and readiness review. Individual/company fields, FR/EN preference
and separate versioned sample acknowledgments are saved through the backend.
Unsaved identity details remain in screen memory, without browser working-copy
persistence. Save these before staging evidence; changing them invalidates samples
and consent and makes fitting stale. Apply migration 010 and backend setup; see
[owner/consent acceptance](../docs/DEVELOPMENT-OWNER-CONSENT.md). Phone OTP remains
deferred and production consent unverified. Submission remains
disabled. Older foundation descriptions below predate the connected identity,
vehicle, draft, sample evidence and provisional seal work; use the root README
and feature guides for current status.

Gemini has since added a partial frontend prototype. See the current
[frontend audit](../docs/FRONTEND-AUDIT.md) and [local Android setup](../docs/ANDROID-SETUP.md).
For standalone numbered client demos, see [client APK builds](../docs/CLIENT-APK-BUILDS.md).
Double-click `../Preview App.cmd` to preview, or `../Android App.cmd` for a USB Android phone.

One Expo / React Native TypeScript app for Android first. This is a working navigation
and integration foundation; the business screens are intentional placeholders for Gemini.
Use [the Gemini prompt](../docs/GEMINI-FRONTEND-PROMPT.md) from the repository root.

## Prepared

- Expo SDK 57, React Native 0.86.3, React 19.2.3; npm package lock.
- Expo Router with Check / My vehicles / Alerts / Account.
- Guarded agent, institutional and administration entry routes.
- Shared white/navy/yellow tokens and accessible native UI primitives.
- English/French resources with English as the default in preview and live modes; French remains selectable.
- TanStack Query provider, React Hook Form and Zod dependencies.
- Supabase client factory with native SecureStore, tab-scoped development web auth and memory-only production web auth.
- Typed API boundary; no secrets or invented domain endpoints.
- Camera/QR, photos/documents, filesystem/image manipulation, network state and push dependencies.
- SQLCipher native plugin and development/preview/production EAS profiles.

Packages and config do not mean their product workflows have been implemented.
No OTP/payment/provider connection, backend, database schema, encrypted draft storage,
attachment encryption, live notifications, final logo/icons or completed business UI exists yet.

## Start on this Windows computer

Node 22.15.0 and npm 10.9.2 were detected. Dependencies have been installed.
Use the .cmd launchers because PowerShell blocks npm.ps1; no execution-policy change is needed.

```powershell
cd C:\Users\Pc\Desktop\Projects\AutoGuardian\mobile
npm.cmd run web
```

The browser preview is the same React Native app, useful while designing.
Open Account to switch English/French and preview a section. Section previews use synthetic
development identities. The institutional example is a registry layout, not combined police access.

On a fresh clone, first run `npm.cmd ci`. Use npm only; keep package-lock.json.
The local .npmrc keeps the install cache in the repository's ignored .npm-cache directory.

## Native Android

SQLCipher requires a custom development build; Expo Go is not the full native test target.
JDK 17, adb, Android SDK 36/build tools, NDK, CMake and Gradle are now installed
under the project's ignored `.tools/` directory. `Android App.cmd` configures their
paths for its process. Android Studio is not required for this command-line setup.
The emulator executable is installed, but a system image/AVD and working hypervisor
still need setup; no Android phone was connected during the review.

After configuring Android Studio, a matching JDK/SDK and emulator/device:

```powershell
npm.cmd run android
# After the development build is installed:
npm.cmd run android:start
```

Alternatively, sign in to your own Expo account and configure an EAS project to use
`npx.cmd eas-cli@latest build --platform android --profile development`.
No EAS account, project, paid service or build has been created here.
Package IDs in app.json are editable setup defaults; confirm them before distribution.
Windows cannot build iOS locally.

## Configuration and live mode

No .env is required for the development preview. Copy .env.example to .env when needed.
EXPO_PUBLIC variables are embedded in the client. Supply only the public Supabase key,
public URLs and mode; never service-role/provider/signing secrets.

The runtime enables synthetic previews only when __DEV__ is true and mode is not live.
Release bundles always disable fixtures even if EXPO_PUBLIC_APP_MODE=demo.
Live mode starts at Welcome with no session/grants until genuine auth/role loading is connected.
The development browser keeps auth in the current tab across refreshes, with scoped working copies of synthetic form fields/references. Production browser auth remains in memory. Test actual auth payload sizes on native SecureStore;
large values can fail and may need a reviewed encrypted adapter. Handle auth lifecycle and cleanup.

Section gates are navigation guards, not final authorization. Real grants must be derived
from server roles, authority/org scope and required step-up authentication.
Business operations go through the planned backend API, not direct private-table access.
The API helper refuses live requests in demo mode and requires HTTPS and a token in live mode.

## Source structure

```text
src/app/                       Router layouts and small entry screens
src/components/                Shared native UI and foundation placeholders
src/config/                    Runtime mode and public config
src/features/auth/             Session projection and section guards
src/features/verification/     Privacy-limited presentation contracts
src/features/enrollment/       Offline implementation boundary
src/features/institutional/    Institutional implementation boundary
src/features/administration/   Administration implementation boundary
src/i18n/                      English/French resources
src/providers/                 Query, translation and session providers
src/services/                  API, Supabase and session-storage adapters
src/theme/                     Canonical design tokens
tests/                         Permission and production-fixture checks
```

## Checks

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run check:dependencies
npm.cmd run doctor
npm.cmd run export:android
npm.cmd run export:web
```

Android export verifies JavaScript bundling, not an APK, device behavior or SQLCipher.
Android 8 support, an under-30-MB release, 3G performance, permissions, encrypted files
and bilingual text scaling still need native acceptance evidence.

Setup verification on 4 October 2026: TypeScript and lint passed, all four permission/
production-fixture tests passed, dependency compatibility passed, and Expo Doctor
passed 21/21 checks. Android Hermes and browser exports passed. The development
server returned HTTP 200. Interactive browser controls were unavailable, so no
visual interaction check was completed. No APK/emulator/device test was performed.

References: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/),
[Router setup](https://docs.expo.dev/router/installation/),
[development builds](https://docs.expo.dev/develop/development-builds/introduction/),
[SQLCipher](https://docs.expo.dev/versions/latest/sdk/sqlite/).
