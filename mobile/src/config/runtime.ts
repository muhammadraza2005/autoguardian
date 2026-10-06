const requestedMode = process.env.EXPO_PUBLIC_APP_MODE;

export const runtime = {
  // A public env flag alone can never enable fixture identities in a release.
  isDemo: __DEV__ && requestedMode !== 'live',
  developmentEmailAuth: __DEV__ && requestedMode === 'live' && process.env.EXPO_PUBLIC_DEV_EMAIL_AUTH === 'true',
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL?.trim() ?? '',
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '',
  supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '',
} as const;
