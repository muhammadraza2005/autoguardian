# Real email login for development

This temporary path tests real Supabase authentication and backend profile/role loading while SMS setup is pending. Phone OTP remains the production requirement. No new SQL migration is needed if 001/002/003 and the development group/login setup already succeeded.

## Create one test account

In your isolated development Supabase project:

1. Ensure **Authentication → Sign In / Providers → Email** is enabled.
2. Open **Authentication → Users → Add user → Create new user** (labels may vary).
3. Enter a test email and a separate account password. Use **Auto Confirm User** for this development account. Do not use your database password as the test account password.
4. Save it. Do not manually insert into `auth.users` or assign privileged roles. Signing in through the app provisions only `VERIFIER`.

Unconfirmed or anonymous identities are rejected. Public signup/email delivery is not implemented in the app in this milestone.

## Run locally

- Double-click **Start Backend.cmd** and leave it running. It builds and starts the API on `127.0.0.1:3000`.
- Stop any previous Expo preview on port 8081, then double-click **Preview Live Login.cmd**. Open `http://localhost:8081`.
- Sign in with the test account. The connected-account page should show its real profile ID, development-group ID and `VERIFIER` role.
- Refresh profile, sign out, and sign in again. Repeated sign-in should reuse the profile ID without duplicate verifier grants.

**Preview App.cmd** still opens the separate synthetic design preview. Real login does not enter sample vehicle/payment screens. Development browser auth now uses tab `sessionStorage`, surviving refreshes in the same tab; production web retains memory-only auth. Native sessions use the existing SecureStore adapter; size/persistence still need device validation. This milestone does not include an APK.

Same-account `SIGNED_IN`/`TOKEN_REFRESHED` events now refresh credentials/profile in the background without clearing screens or query data. Sign-out, an account change or a verified role/scope change clears domain state and unfinished forms. Backend authorization still runs on every request. Failed background network refresh does not erase an editor; confirmed authentication/access rejection clears its identity. Developer server restarts and full reloads still rebuild the JavaScript view, but the development login and whitelisted sample form fields recover from this tab's storage. File bytes, passwords, PINs and private query caches are not stored there. After first installing this change, sign in once to establish the tab session.

## Read your owned vehicles

After SQL migration `202610060004_owned_vehicle_reads.sql` and the development vehicle setup have succeeded:

1. Sign in and select **Refresh profile** to reload the test account's `OWNER` role.
2. Select **My vehicles** on the connected-account page. Your development account should show **DEV-001** with **Pending review**.
3. Select **View details** to load the record from the backend, including chassis, make, model and any supplied year/color. Pending review does not mean active enrollment.
4. Use **Refresh vehicles** to check again. An account without current ownership has an empty list; missing or inaccessible detail records show the same unavailable message.
5. Sign out and confirm that vehicle routes return to sign-in without showing the previous account's records.

The live vehicle routes use the signed-in session token and validated API responses, with pagination and retry states. They keep account-scoped data only in memory, clear it on identity/profile changes, and recheck on navigation focus. No vehicle writes, photos, subscription payment, seals or sale actions are connected in this step. No additional SQL or environment changes are required.

## Configuration

- Backend: `NODE_ENV=development`, `ALLOW_DEV_EMAIL_AUTH=true`, `CORS_ORIGIN=http://localhost:8081`. Startup refuses the email flag under another Node environment. Default authentication requires a verified phone.
- Mobile: `EXPO_PUBLIC_APP_MODE=live`, `EXPO_PUBLIC_DEV_EMAIL_AUTH=true`, public Supabase URL/key and `EXPO_PUBLIC_API_BASE_URL=http://localhost:3000`.
- Email UI requires `__DEV__`; public flags cannot enable it in a release. HTTP API URLs are allowed only on development loopback/emulator addresses. Production requires HTTPS.
- Server database credentials/service keys must never enter mobile configuration.

This setup targets the browser. Android emulator API loopback would use `10.0.2.2`; physical-device networking/transport configuration is a separate task. No native network permissions or production transport rules were changed.

Before production, disable backend development email auth, use a production Node environment, configure SMS and implement phone OTP/role-specific authentication. Database roles do not unlock unfinished privileged screens.

References: [Supabase React Native Auth](https://supabase.com/docs/guides/auth/quickstarts/react-native), [password sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithpassword).
