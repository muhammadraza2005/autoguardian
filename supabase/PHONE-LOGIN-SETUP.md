# Supabase phone login: next setup step

## 1. Confirm the database

In Supabase **SQL Editor**, run [verify-foundation-summary.sql](verify-foundation-summary.sql) as `postgres`. It returns one grid with six checks. Every result should say `PASS`. This avoids needing to switch between the three results from the earlier verification file. It reads your configuration; it does not change data.

Do not rerun migration 001 if it already succeeded. If a check fails, share the check name or SQL error before changing permissions.

## 2. Configure phone authentication in the dashboard

Phone authentication settings are not business-table SQL queries. They belong to Supabase Auth settings.

1. Open your **development** project's **Authentication** settings.
2. Find the **Auth Providers** / **Sign In / Providers** page, then **Phone** (dashboard labels may vary).
3. Enable phone sign-in. Keep anonymous sign-in disabled for this app.
4. Choose the applicable setup below. Save the settings.

### Development with test OTPs

Use the Phone provider's test phone/OTP settings, if available in your hosted dashboard. Register a dedicated test number and a fixed six-digit code, with an expiry if the dashboard offers it. Follow the format shown by the field. The app will later submit the number in international format, including its country code.

Test OTPs skip real SMS delivery for configured numbers; they do not prove SMS delivery works. Use them only in a separate development project, not for a real user's account. Real numbers outside the test mapping still need an SMS provider. If Supabase requires provider credentials before saving, stop at that step: do not enter invented credentials or change the production project. We can choose a provider or a local Auth test setup next.

### Development with an existing SMS provider

Choose your provider and enter its credentials directly in the Supabase dashboard. Use a test destination you control and verify that your provider permits delivery to its country. Real SMS may incur provider charges. Don't send provider secrets in chat or put them in the mobile environment file.

## 3. What to report back

- Whether all six database checks show `PASS`.
- Whether Phone sign-in settings saved successfully.
- Whether you configured test OTPs or an actual SMS provider. If blocked, send the error text without credentials.

At this stage, configuring the provider does not make the existing demo login screens perform real authentication. We will verify requesting an OTP and signing in when wiring real Auth calls. Successful Auth creates an identity in Supabase's managed `auth.users`; the backend must subsequently provision the authority profile and `VERIFIER` role. No public signup gets administrator access.

No backend or app login changes are part of this setup step.

References: [official phone-login guide](https://supabase.com/docs/guides/auth/phone-login), [Auth test OTP behavior](https://supabase.com/docs/guides/self-hosting/self-hosted-phone-mfa), [hosted Auth configuration fields](https://supabase.com/docs/reference/api/v1-update-auth-service-config).
