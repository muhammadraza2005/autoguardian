# Connected agent enrollment wizard

Implemented 9 October 2026. The genuine development agent flow now uses the
original Clean Trust agent header, navy/yellow styling, cards and bottom tabs.
The connected forms replace the disconnected wizard in live development mode.
The synthetic design preview remains available only in development demo mode.

## Start and navigate

1. Start **Start Backend.cmd** and **Preview Live Login.cmd**.
2. Sign in with the accredited development agent account. Open **Enrollment
   drafts** from the account, or visit `http://localhost:8081/agent` in that tab.
3. Use the **Enrollments**, **New enrollment**, **Seal stock** and **Account** tabs.
   **Start a new enrollment** explicitly starts a new vehicle draft;
   **Continue enrollment** resumes the selected server draft.
4. The wizard steps are **Vehicle → Owner → Documents → Seals → Review**.
   Save vehicle changes to continue to Owner. Save fictional owner details and
   record the separate sample acknowledgments before continuing to Documents.
5. Stage fictional identity, registration and vehicle samples. Pending uploads
   do not complete a step. Save package/fitting selections; a complete sample
   fitting advances to Review, while a partial fitting stays editable.
6. Review uses saved server data. **Refresh readiness** obtains a new snapshot
   and hides old results while loading or after an error. A changed draft revision
   makes previous fitting stale until resaved.

Step buttons allow returning to saved draft sections. Unsaved changes and pending
operations disable wizard step changes. Vehicle and fitting working copies retain
their existing scoped development recovery; owner identity fields and retry bodies
stay in component memory and must be saved before leaving or reloading. Reload
actions explicitly discard edits. Progress counts the four preparation steps only;
Review never becomes a completed registration.

The old `/live-enrollments` list, new, draft, owner, attachments, seals, stock and
review URLs redirect to the matching agent tab/step. Invalid draft IDs are rejected;
missing drafts and revoked access do not fall back to fixtures.

## Boundaries and setup

No SQL migration or backend API change is introduced by this UI integration.
Existing migrations 001–010 and backend development settings remain prerequisites;
see [owner/consent setup](DEVELOPMENT-OWNER-CONSENT.md),
[sample evidence setup](DEVELOPMENT-EVIDENCE-UPLOADS.md) and
[seal fitting setup](DEVELOPMENT-SEAL-FITTING.md).

The agent shell requires the development email-auth flag and a genuine server
profile with an organization-scoped `ENROLLMENT_AGENT` role. This does not grant
production agent permissions. Release builds cannot enable this development flow.
All writes continue through the restricted backend with existing authorization,
revisions and retry keys.

**Submission unavailable** stays disabled. Phone OTP remains deferred. Production
authentication, authenticated owner consent, full evidence and physical seal
validation, payment, authority review rules and atomic finalization are pending.
Native private uploads remain gated; encrypted offline storage and synchronization
are still unfinished.

## Validation and remaining acceptance

TypeScript, lint, 31 mobile tests and web/Android Hermes bundle exports pass.
The offline dependency check reports current installed dependencies with Expo's
offline reliability warning; previously documented online patch recommendations
remain a separate maintenance task. Android export is not device acceptance.

Signed-in browser checks confirmed the original agent shell, saved-draft navigation,
owner form, sample upload controls, saved progress and disabled submission. Browser
automation subsequently stopped because it could not reliably identify the current
URL, so complete the manual walkthrough below before calling this fully accepted.

- Create a dedicated fictional draft; save vehicle, owner details and sample
  acknowledgments. Confirm each save and forward step uses the saved draft ID.
- Upload the three sample document types; save no-seals or a complete four-seal
  sample fitting. Confirm pending uploads and partial/stale fitting do not count.
- Edit owner details and check that old consent/evidence disappear and fitting
  needs resaving. Verify failed/ambiguous saves retain the existing retry behavior.
- Switch away and return to the same browser tab. It must preserve form state
  without a page reload. Test explicit reload and returning from other app tabs.
- Check English/French, narrow displays, keyboard navigation and text scaling.
- Open old development links, malformed IDs, an unavailable UUID and a revoked
  account. Confirm errors without sample fallback or stale readiness.
- Confirm all sample preparation can complete while submission stays disabled.
- Repeat relevant navigation and forms on Android. Native private file upload and
  encrypted offline acceptance are separate unfinished work.
