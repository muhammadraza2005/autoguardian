# AutoGuardian

Current Gemini frontend review: [completion audit](docs/FRONTEND-AUDIT.md).
Double-click `Preview App.cmd` for the browser preview.
Native setup and launcher: [Android setup](docs/ANDROID-SETUP.md).
Numbered APK deliveries: [client APK builds](docs/CLIENT-APK-BUILDS.md).
Supabase database setup: [SQL scripts and execution order](supabase/README.md).
Identity backend setup: [API endpoints and configuration](backend/README.md).

The Android-first React Native foundation is in [mobile/](mobile/README.md).
The product screens are ready for Gemini to implement.

- [Prompt to paste into Gemini / Antigravity](docs/GEMINI-FRONTEND-PROMPT.md)
- [Review of the updated Stitch files](docs/STITCH-REVIEW.md)
- [Frontend requirements and screen inventory](frontend.md)
- [Backend plan](backend.md) and [Supabase plan](supabase.md)

Open this entire folder in Antigravity so Gemini can see the app and its references.
Use the prompt above. The existing Stitch files and planning documents are preserved.
The primary consumer and owner visual references are the PNG/HTML pairs under
`two screens/stitch_autoguardian_unified_mobile_app/`; the prompt explains their priority and corrections.

For a browser preview of the prepared foundation:

```powershell
cd C:\Users\Pc\Desktop\Projects\AutoGuardian\mobile
npm.cmd run web
```
