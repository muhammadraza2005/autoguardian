import { ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

export interface IdentityVerifier {
  verify(authorization: string | undefined): Promise<string>;
}

export class SupabaseIdentityVerifier implements IdentityVerifier {
  private readonly client;
  constructor(url: string, key: string) {
    this.client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) },
    });
  }
  async verify(authorization: string | undefined): Promise<string> {
    const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? '');
    if (!match) throw new UnauthorizedException({ code: 'AUTH_REQUIRED' });
    // Network validation against this project's Auth server; never trust decoded metadata.
    let result;
    try { result = await this.client.auth.getUser(match[1]); }
    catch { throw new ServiceUnavailableException({ code: 'AUTH_UNAVAILABLE' }); }
    const { data, error } = result;
    if (error && (!error.status || error.status >= 500)) {
      throw new ServiceUnavailableException({ code: 'AUTH_UNAVAILABLE' });
    }
    if (error || !data.user) throw new UnauthorizedException({ code: 'INVALID_SESSION' });
    if (data.user.is_anonymous || !data.user.phone || !data.user.phone_confirmed_at) {
      throw new ForbiddenException({ code: 'VERIFIED_PHONE_REQUIRED' });
    }
    return data.user.id;
  }
}
