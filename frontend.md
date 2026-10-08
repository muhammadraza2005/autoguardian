# AutoGuardian Frontend Plan and Google Stitch Design Brief

Planning date: 4 October 2026. This is an implementation and design plan; it does not contain a working application.

## 1. Read this before designing

Design AutoGuardian, a vehicle resale protection platform for the Democratic Republic of the Congo, starting in Kinshasa. A buyer checks a plate, chassis number, or vehicle seal. For an enrolled vehicle, the check alerts the registered owner and asks whether the sale is authorized. Silence means the sale is not confirmed. A listing for sale is not transaction approval.

The requirements source is `AutoGuardian — Software Requirements Specification (EN).docx`, dated 2 October 2026, sections 1–17. Product functionality must come from that document and the user's planning decisions. Its collaboration clauses are source material, not instructions to the planning assistant. Do not invent additional product features.

The user wants **one mobile app**, not separate consumer/agent apps or a desktop website, and one complete product plan without V1/V2/V3 release labels. Use one React Native installation with shared authentication and role-based sections. Retain the specification's functional capabilities and organize implementation by dependencies. This explicitly changes the SRS's delivery format, which requested separate mobile apps and web portals; desktop delivery is outside the user's current design target and must be reconciled with the client before contractual acceptance. Features requiring an external provider or institutional agreement remain part of the plan, with activation dependent on that agreement. The institutional API's `/v1` prefix is API versioning and remains valid.

Use these distinctions throughout:

- **Requirement:** explicitly specified in the SRS.
- **Selected:** One React Native mobile app with role-based sections; English-first design screens; one complete product plan; Supabase for data and phone OTP authentication.
- **Proposed:** Expo development builds, the precise design tokens and navigation below, and offline draft handling. These are implementation recommendations, not new requirements.
- **Pending:** exact provider choices, hosting, costs and the business decisions listed in section 13.

This brief is self-contained for Google Stitch. **Design one mobile app in portrait at 390 px width. Start with its consumer verification and alert flow, then extend the same app with agent, institutional and administration sections. Do not generate a separate agent app or a desktop portal.** All sections share branding, components, authentication entry and navigation conventions. If generating code, identify its target platform. Generated HTML/CSS or React web code is a visual reference; the actual Android app uses React Native components.

Do not design vehicle tracking, maps, GPS permissions, a vehicle marketplace, seller confrontation tools, buyer-to-owner chat, public owner profiles, or public owner contact details. None is required. Seal alarms are physical tear-off buzzers, not connected sensors controlled by the app.

## 2. Sections inside the single app

| App section | Audience | Design target |
| --- | --- | --- |
| Consumer | Verifiers, owners, backup contacts, authorized sellers and professionals | Mobile screens inside the shared app |
| Enrollment agent | Accredited enrollment agents | Authorized agent mode, encrypted offline drafts and synchronization |
| Institutional | Police, registry officers and insurers | Authorized mobile workflows for the relevant institutional role |
| Administration | Authority/platform administrators, organization managers, support and auditors | Authorized mobile management screens |

There is one installed app, one authentication system and one shared backend/database. After authentication, the server's role assignments determine the visible sections and actions. An account with several assigned roles can switch between permitted sections; switching sections does not grant permissions or bypass a required password/OTP/PIN challenge. Ordinary users do not see agent or administrative tools. Public signup cannot choose an institutional role.

The SRS also requires SMS, USSD, notifications and an institutional API. Design the basic-phone menu flows and message states here; implementation belongs to `backend.md`. Do not replace basic-phone access with a smartphone-only alternative.

For each screen, provide its name, intended role, layout, fields, primary and secondary actions, navigation destination, and loading/empty/error/success/permission-denied variants where relevant. Provide components and tokens in addition to complete screens. Reference SRS flow identifiers F1–F11 in screen annotations.

## 3. Visual direction

Client instruction: white background `#FFFFFF`, violet or navy as the secondary color, plus yellow. The proposed palette is **white + navy + yellow**; navy versus violet remains open until confirmed. Exact values below are proposed tokens.

| Token | Proposed value | Use |
| --- | --- | --- |
| background | `#FFFFFF` | Main app and page background |
| primary | `#142B4A` | Navy primary buttons, headings and navigation |
| accent | `#F4C542` | Yellow highlights and selected accents; navy text on yellow |
| text | `#172033` | Body text |
| textMuted | `#536174` | Supporting text |
| surface | `#F5F7FA` | Secondary surfaces |
| border | `#D6DCE5` | Separators and input borders |
| success | `#166534` | Confirmed result, paired with text/icon |
| danger | `#B42318` | Missing vehicle, denied sale and destructive actions |
| warning | `#7A4C00` | Warnings, paired with readable pale backgrounds |

Favor clear typography, simple forms and prominent actions. Use native-feeling Android controls with modest corner rounding, restrained shadows and familiar line icons. Proposed base text is 16 px with generous line spacing and touch targets at least 48 logical pixels. Validate actual contrast, text scaling and keyboard behavior during implementation. Do not rely on color alone for status.

Keep pages lightweight and usable on a small entry-level phone. Avoid large decorative images, complex animation and dense dashboards in the consumer app. Use clear labels instead of icon-only navigation. Authority branding is configurable: logo, bilingual authority name, colors and legal notices come from authority settings.

Create English screens first. Provide French variants for critical flows and reusable components with room for longer translations. The project owner selected English as the app's initial runtime language on 9 October 2026, replacing the proposed French default. French remains available through the language switch.

## 4. Shared states and components

Design a reusable set of phone inputs, OTP fields, PIN entry, password/MFA fields, vehicle summaries, status badges, seal results, verification progress, payment summaries, receipts, alerts, consent controls, upload controls, wizard steps, confirmation dialogs, audit tables and permission-denied views.

Required shared behavior:

- Phone numbers use an international prefix; the initial authority configuration proposes `+243`.
- Labels always pass through English-keyed translation resources. User preference governs messages; French and English exist across all channels.
- Amounts show currency and come from configuration, never a fixed UI price.
- Dates localize by language and authority time zone. Enrollment location labels and dashboard areas are administrative information, not GPS coordinates.
- A weak network produces clear retry and pending states. Never display a cached sale authorization as a current approval.
- A delayed payment is pending until server confirmation; retrying must not create a duplicate payment.
- Camera denial offers manual seal code, plate or VIN entry. Unreadable QR codes and revoked seals have explicit states.
- No sensitive notification preview should expose documents, owner details or a PIN. The buyer's payload contains no owner name, phone or address.
- Sensitive actions require the appropriate server-validated authentication. A successful local PIN screen alone is not authorization.

Use a neutral placeholder logo until an approved logo is supplied. Any prototype records are clearly synthetic design examples, not facts about the project or real vehicle owners.

## 5. Consumer section screens

Proposed main navigation is **Check**, **My vehicles**, **Alerts**, **Account**. Show only actions allowed by the account's assigned roles. One account can have several roles; enrolling a vehicle is never a consumer self-service action.

### Access and account management F11

1. Language selection and welcome, with authority identity and a concise explanation of vehicle checks.
2. Phone sign-in and OTP verification, including resend timer, expired code, incorrect code, delivery failure and lockout states. Do not include social login as an alternative requirement.
3. Versioned terms and data consent; insurer-sharing consent is separate when needed.
4. Owner PIN setup and confirmation, using the required 4–6 digits. Owners are created through enrollment, not by claiming a vehicle in the app.
5. Account preferences for language, active alert channels and session logout.
6. Agent-assisted phone number change instructions; no self-service replacement of a verified owner phone number.
7. Backup contact management: invite by phone, pending invitation, acceptance by OTP, accepted contact, change/remove, and delegated permissions.
8. Death/incapacity procedure entry explaining that administrators handle supporting documents. Exact recovery and PIN-reset procedures need confirmation; do not invent an instant bypass.

### Buyer verification F2 F3

1. **Check a vehicle:** plate, chassis number or QR/manual seal identifier; a clear selector for input type.
2. **Price and quota:** configured price, remaining free allowance and any role exemption. SRS proposed defaults are USD 2 and one free check per phone per month; label prototype amounts as configurable examples.
3. **Payment:** eligible mobile-money methods, and card when its provider is configured; pending, confirmed, failed and refunded variants.
4. **Vehicle status:** show only authorized vehicle information, sale status, trust level and any seal result. Paid results remain hidden until payment confirmation.
5. **Waiting for the owner:** server-backed progress and deadline. Show backup notification progress when appropriate; never reveal the backup contact's identity.
6. **Transaction result:** separate screens for confirmed, denied, no response and expired confirmation. A confirmation applies only to this buyer, vehicle and validity period.

| Display condition | Required interpretation |
| --- | --- |
| Unknown vehicle | Not protected by AutoGuardian; no invented owner alert |
| NOT FOR SALE | Not listed for sale; owner still receives an alert |
| FOR SALE | Listed for sale; wait for transaction confirmation |
| SALE BY AUTHORIZED AGENT | Authorized seller appointed; owner still confirms the transaction |
| REPORTED MISSING | Do not pay; contact police; required notifications follow |
| SALE CONFIRMED | Owner approved this transaction; show expiry |
| SALE NOT CONFIRMED | Owner refused; do not pay |
| NO RESPONSE | Sale not confirmed; silence does not grant permission |

Show the SRS safety reminder and configured emergency number on every verification result/progress screen. The emergency number is a configuration placeholder until supplied. Do not invent a phone number.

### Owner vehicle management F3 F4 F5 F10

1. Vehicle list with plate, category, sale status, administrative/subscription state and trust level.
2. Vehicle detail with authorized photos, seals overview, subscription summary and owner's verification history. Omit confidential alarm-seal locations from consumer views.
3. Owner authorization request: vehicle, request reference, Yes/No actions, PIN challenge, deadline and success/expired/already-answered variants.
4. Grouped alerts: show that several checks occurred. Each approval remains bound to an individual verifier request; do not offer one approval that automatically approves all buyers. Exact grouping interaction awaits business confirmation.
5. List for sale with duration and PIN; remove listing; explain automatic expiry to NOT FOR SALE.
6. Seller mandate: phone invitation, duration within configured maximum, acceptance by OTP, active/expired/revoked states and owner revocation. An authorized seller cannot approve the owner's sale alert.
7. Report missing: date, approximate time, optional comment, immediate success state and optional police report number. Distinguish a personal missing report from one with an official police reference.
8. Lift missing report: reason required, available only to authorized actors. Backup contacts cannot lift reports.
9. Subscription: due dates, configured installments, renewal payment, receipt and overdue/grace/suspended states. Explain that resale alerts continue even when subscriptions are unpaid.

### Ownership transfer F6

Design transfer initiation by the current owner or authorized seller; buyer phone invitation; buyer OTP acceptance; identity-check pending state; seller PIN confirmation; registry/lock pending state when configured; refusal; completion.

After completion, the new owner's vehicle is NOT FOR SALE. The former owner loses access. The new owner does not see the former owner's personal verification history. Do not add a transfer shortcut that skips identity checks or the final seller confirmation.

### Backup contact and authorized seller

Backup contacts see accepted invitations, relevant alerts and missing-report actions within delegated permissions. The SRS permits delegated alert responses but also describes the owner as the only sale authorizer; positive backup approval is pending clarification. Design a permission-controlled state without assuming that permission is granted.

Authorized sellers see accepted mandates, expiry/revocation and transfer initiation. They do not receive ownership privileges or authority to approve a sale alert.

### Professional verification and clearance F8 F9

Provide professional package balance, validity and purchase states using configuration; no invented package tiers or prices. Authorized professionals can perform the seal checks permitted by the matrix but never view owner identity.

For owners and permitted institutional actors, design clearance requests for registration, insurance or transfer: consent request, checks pending, approved/refused, refusal reason, validity and authenticity QR. A displayed token/report must not imply that all institutions already enforce a lock. Keep locks disabled until configured and agreements exist.

## 6. Enrollment agent section screens F1 F7 F11

Inside authorized agent mode, proposed navigation is **Enrollments**, **New enrollment**, **Seal stock**, **Account**, with a visible synchronization indicator and return to other permitted sections. Reuse the app's design system and authentication entry; do not create a second app onboarding flow. Agent mode still requires its stronger authentication and accreditation checks.

1. Password + OTP sign-in, agent accreditation state and suspended-account view. Offline access after previous authentication requires a separately confirmed validity policy.
2. Enrollment list with local draft, ready to sync, syncing, needs action, pending review, active and rejected states. These are proposed UI workflow labels, not additions to the SRS vehicle-status enum.
3. Enrollment wizard:
   - Plate/VIN input or scan, category, make, model, year, color and administrative location label.
   - Vehicle photos in at least four views; chassis and plate photos.
   - Individual/company owner details, identity document, registration certificate or purchase invoice, language and phone.
   - Owner OTP verification, with a pending-online state when offline.
   - Package selection: NONE, STANDARD, ONE_ALARM or FOUR_ALARMS; prices from configuration.
   - For a sealed package, scan all four seals, assign positions and photograph each fitted seal. Alarm classification is visible only to authorized operational roles.
   - Enrollment/seal/first-installment payment; mobile money, configured card or organization cash collection if permitted.
   - Review and submit; second-review pending state if configured.
4. Duplicate plate/VIN or seal conflict: preserve the local draft, show actionable conflict and server incident reference; do not overwrite an existing record.
5. Sync queue with per-draft progress, attachment progress, retry and explicit server rejection. Do not show unsynchronized drafts as enrolled or protected vehicles.
6. Seal stock with assigned batches, availability and status. Offline use of stock needs server reconciliation; it cannot guarantee that stock is still available.
7. Seal replacement: identity/vehicle check, old identifier, revocation reason, replacement code, position/photo, fee and completion.
8. Agent-assisted phone change: identity check, new-number OTP and completion after server validation.

**Proposed offline resolution:** collect and encrypt drafts offline. Activate only after server duplicate/accreditation checks, required attachments, owner OTP, payment confirmation and any required authority review. Offline storage includes encryption of photo files as well as the local database. Never fabricate OTP success or payment confirmation offline.

## 7. Institutional section F8 F9

Use mobile navigation and a compact header showing authority, active role and language. Reuse shared components and require the confirmed role authentication policy before accessing institutional tools. Convert large tables into searchable lists with filters and detail screens; do not generate a desktop layout for this design task.

| Screen group | Required contents and constraints |
| --- | --- |
| Lookup and identity access | Plate/VIN/seal lookup; purpose/reason before owner identity access; role and authority scope enforced |
| Seal inspection | One/multiple seal scans, 4/4 through 1/4, revoked and other-vehicle results; anomaly reporting |
| Missing reports | Report feed, personal versus official police reference, authorized report/lift actions with reasons |
| Registry counter | Permitted enrollment and identity validation, ownership transfer validation, clearance request and token consumption |
| Insurance operations | Insured-vehicle scope with owner consent, insurance clearance and permitted reports |
| Clearance management | Pending/issued/refused/expired/consumed, operation and requesting organization binding |
| Incidents | Authorized anomaly submission and processing views |
| Dashboards | Role-scoped indicators, period/area filters and CSV/PDF exports |

Police and registry officers may view identity after recording a reason; insurers are limited to insured vehicles with consent. A generic institutional login must not reveal every owner's data.

## 8. Administration section

Design these modules as mobile management screens within the same app, with role-specific permission states. Use summary cards, filters, paginated lists and record-detail screens for dense operations; retain required exports and management actions without designing a separate website:

- Authorities, organizations, agent creation/accreditation/suspension and institutional/API account management.
- Enrollment review, supporting evidence access, decision and reason; review flags for a suspended agent's last 90 days of enrollments.
- Seal batches, manufacturer, organization/agent allocation and revocation within permission scope.
- Authority configuration: bilingual identity/branding, country/currency/time zone, prices/free quotas/exemptions/caps, subscriptions/installments/grace, seals, revenue splits, deadlines, mandates, locks, trust labels and enabled channels.
- Versioned FR/EN screen/message/terms templates and connector settings. Connector credentials use write/replace controls without displaying saved secrets.
- Incident queue, priority, assignment and resolution.
- Payments, reasoned refunds, cash collection/remittance if enabled, reconciliation discrepancies and monthly beneficiary statements.
- Audit search and exports, with masking and mandatory reasons for sensitive identity access.
- Support workflow with masked identities and permitted refunds; no vehicle-edit controls.
- Exceptional access/procedures for administrators, including death/incapacity and audited emergency personal-data access.

Dashboards cover enrollments by category/municipality/organization/period, seal packages, checks by channel/result, unconfirmed sales, missing reports, response time, incident processing, revenue/shares, renewals, agent activity/anomalies and lock tokens. Third-party statistics must be aggregated and anonymized. Organization managers see only their organization; platform admins have no routine personal-data access; auditors remain read-only except authorized viewing/exporting.

## 9. SMS USSD and notification flows

Provide text-flow annotations alongside the visual screens:

- USSD first screen: FR/EN language choice, remembered thereafter; verification by plate/VIN/manual seal code, mobile-money payment, sale-status management, owner response and missing report.
- SMS: verification, owner alert/response, missing-report keyword and receipts. Final keywords, short code and request-reference syntax depend on the aggregator and are pending.
- Push and SMS alerts are the initial proposed active channels from the SRS settings. WhatsApp answer buttons and automated voice are configurable channels requiring separate provider capability decisions.
- Status, consent and transaction outcome messages must exist in both languages. SMS variants fit 160 characters with unaccented text where required by operators. Validate the expanded message with plate/reference substitutions, not just its template.
- Notification failure is a delivery state, never an owner refusal or approval. No response is decided by the deadline.

Use the exact meanings in SRS section 10, including “Sale confirmed by the owner for this transaction,” “Sale not confirmed: the owner did not respond,” and “Never confront the seller. If in doubt, contact the police.” The authority may edit templates by language without changing business rules.

## 10. Proposed frontend implementation stack

One React Native app is selected. Expo with TypeScript and development builds is proposed to simplify setup while supporting native capabilities. Use feature modules for consumer, agent, institutional and administration workflows, sharing translations, typed API contracts, design tokens and native components. There is no separate React website in the current implementation target. Keep privileged modules inaccessible without server authorization and isolate encrypted agent drafts from consumer caches, including on role/authority switching and logout.

Candidate packages to validate and pin together during implementation:

| Purpose | Candidate |
| --- | --- |
| Native routing | Expo Router |
| Server requests and cache | TanStack Query plus a typed API client |
| Forms and validation | React Hook Form and Zod |
| Localization | i18next and react-i18next |
| Supabase phone authentication | `@supabase/supabase-js` with secure session-storage integration |
| Camera and QR reading | `expo-camera` |
| Protected device secrets | `expo-secure-store` |
| Agent draft database | `expo-sqlite` with SQLCipher |
| Attachments and compression | `expo-file-system`, `expo-image-manipulator`, document selection where needed |
| Push | `expo-notifications`; server adapter aligned with SRS FCM/APNs |

These are proposed dependencies, not installed packages or guaranteed compatible versions. SQLCipher requires native configuration and a development build; it is not supported by Expo Go. [Expo SQLite documentation](https://docs.expo.dev/versions/latest/sdk/sqlite/).

A database key must be randomly generated and protected, never hard-coded. Encrypt local attachment files separately with a reviewed native-capable solution; SQLite encryption does not encrypt image files. Remove GPS EXIF metadata. Do not persist private documents or PINs in unencrypted general-purpose key-value storage.

## 11. Windows setup checklist for the build stage

No packages are installed as part of this planning task. When implementation starts, help the user through:

1. Inspect existing Node.js, npm, Git, JDK and Android tools before installing anything.
2. Choose a supported stable Expo/React Native pair and matching Node/JDK/Android SDK from official documentation; pin versions. The changing latest version is not a permanent requirement.
3. Install Android Studio, the matching Android SDK/build tools, platform tools and an emulator; configure the SDK path and verify `adb`.
4. Create one TypeScript mobile app workspace with role-based feature modules; keep one documented package-manager strategy and lockfiles.
5. Add dependencies in small groups, using `npx expo install` for Expo/native packages, checking compatibility and rebuilding after native configuration changes.
6. Configure a development build, SQLCipher, secure storage, camera and push; run on an emulator and an entry-level physical Android phone.
7. Connect local/staging API and Supabase test configuration; use development-only OTP/test provider paths that cannot be enabled in production.
8. Validate Android 8 support, the under-30-MB release-size target and 3G usability early. A large development build is not a release-size measurement. Any inability to meet the target needs a documented decision, not a silent change.

[React Native setup guidance](https://reactnative.dev/docs/set-up-your-environment), [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/), [Expo SDK compatibility](https://docs.expo.dev/versions/latest/).

## 12. Implementation milestones and acceptance

These are construction milestones for one product, not separate promised releases.

| Milestone | Frontend result | Acceptance evidence |
| --- | --- | --- |
| Design foundation | Tokens, translations, role navigation and critical flow prototypes | English designs and French critical variants; permission review |
| Native foundation | One app shell, role-based sections, camera, secure storage and encrypted agent drafts | Android 8 device run, attachment encryption, role isolation and size feasibility |
| Verification and enrollment | F1–F4 and F7, payment gating and live request progress | Unknown/denied/timeout/missing/duplicate/offline cases in both languages |
| Ownership and billing | F5 F6 F10 F11, backup contacts and subscriptions | Transfer access revocation, PIN challenges, renewal and failure cases |
| Institutional and administration | In-app F8 F9, role-scoped management, configuration and dashboards | Identity-reason gating, masking, token expiry/consumption, exports |
| Provider integration and release readiness | Real SMS/USSD/payment flows and configured connectors | Basic-phone FR/EN tests; provider outages; security and performance targets |

Verify that no paid result leaks before payment, FOR SALE never looks like final approval, an expired confirmation cannot be reused, buyer views contain no owner identity or alarm placement, unpaid subscriptions keep owner alerts active, and pending offline enrollment is never represented as live protection.

## 13. Decisions still needed

`backend.md` contains the shared decision register D01–D12. For design, the immediate decisions are navy versus violet, exact SMS/payment providers and budget, approval of the proposed offline activation rule, secure basic-phone responses and delegated backup approval. Provider names may be designed as configuration options from the SRS; do not claim their integration is live.

The source also leaves seal/replacement prices, revenue splits, professional packages, final deadlines, second enrollment review, cash, hosting/localization, retention, pilot area, institutional access and iOS launch timing open. Use placeholders or explicitly labeled SRS defaults. Do not add unsupported dashboard data or commercial promises. The user's single-app direction overrides the earlier multi-app/web design brief; the client still needs to reconcile this delivery format with the SRS's desktop portal requirement.

## 14. Source traceability

| Source | Covered here |
| --- | --- |
| SRS 1–5 | Role-based app sections, privacy, authority configuration; delivery format explicitly changed by user |
| SRS 6 F1–F11 | Enrollment, checks, alerts, missing reports, sale, transfers, seals, institutions, clearances, renewal, accounts |
| SRS 7–9 | Status meanings, business rules, seal packages and model-aligned fields |
| SRS 10–12 | Bilingual channels, payments, institutional operations and connector-dependent states |
| SRS 13–15 | Access controls, offline/performance constraints, audit and dashboards |
| SRS 16–17 and user direction | One complete product; dependencies and unresolved decisions retained |

For API behavior and implementation decisions, read `backend.md`. For schema, identity and storage policies, read `supabase.md`.
