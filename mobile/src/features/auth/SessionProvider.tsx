import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState, Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { runtime } from '@/config/runtime';
import { getSupabaseClient } from '@/services/supabase/client';
import { apiRequest, ApiError, type AuthenticatedRequest } from '@/services/api/client';
import { profileSchema, profileSession, type AccountProfile } from './profile';
import { type AppSection, type SessionView } from './access';
import {preserveAuthView,profileScope} from './authEvents';
import {workingCopies} from '@/features/enrollment/workingCopies';
import {OfflineSyncBridge} from '@/features/enrollment/OfflineSyncBridge';
import NetInfo from '@react-native-community/netinfo';
import {offlineAccess} from './offlineAccessStore';
import {offlineIdentity} from './offlineAccess';

type SessionContextValue = {
  session: SessionView | null;
  profile: AccountProfile | null;
  loading: boolean;
  error: boolean;
  offlineReadOnly: boolean;
  offlineProfile: AccountProfile | null;
  setPreviewSection: (section: AppSection) => void;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => void;
  request: AuthenticatedRequest;
};
const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<SessionView | null>(() => runtime.isDemo
    ? { source: 'design-fixture', subject: 'synthetic-preview', sectionGrants: ['consumer'] } : null);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(!runtime.isDemo);
  const [error, setError] = useState(false);
  const [offlineUntil,setOfflineUntil]=useState<number|null>(null);
  const [offlineProfile,setOfflineProfile]=useState<AccountProfile|null>(null);
  const refreshRef = useRef<() => void>(() => {});
  const clearIdentityRef = useRef<() => void>(() => {});
  const requestRef = useRef<AuthenticatedRequest>(async () => { throw new ApiError(401, 'Sign in again.'); });
  useEffect(()=>{
    if(offlineUntil===null)return;
    const lock=()=>{workingCopies.lock();setProfile(null);setSession(null);setOfflineUntil(null);setOfflineProfile(null);setError(true);};
    const timer=setTimeout(lock,Math.max(0,offlineUntil-Date.now()));
    const subscription=AppState.addEventListener('change',state=>{if(state==='active'&&Date.now()>=offlineUntil)lock();});
    return()=>{clearTimeout(timer);subscription.remove();};
  },[offlineUntil]);

  useEffect(() => {
    if (runtime.isDemo) return;
    let mounted = true;
    let revision = 0;
    let profileRevision = 0;
    let currentAuth: Session | null = null;
    let currentProfile: AccountProfile | null = null;
    let profileReady = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let subscription: { unsubscribe: () => void } | undefined;
    let appState: { remove: () => void } | undefined;
    let cancel: AbortController | undefined;
    try {
      const client = getSupabaseClient();
      requestRef.current = async <T,>(path: string, options: NonNullable<Parameters<AuthenticatedRequest>[1]> = {}) => {
        const auth = currentAuth;
        const generation = revision;
        if (!auth || !profileReady) throw new ApiError(401, 'Sign in again.');
        const controller = new AbortController();
        const abort = () => controller.abort();
        if (options.signal?.aborted) abort();
        options.signal?.addEventListener('abort', abort, { once: true });
        const deadline = setTimeout(abort, 10000);
        try {
          const value = await apiRequest<T>(path, { ...options, signal: controller.signal, accessToken: auth.access_token });
          if (!mounted || generation !== revision) throw new ApiError(401, 'Account changed.');
          return value;
        } finally {
          clearTimeout(deadline);
          options.signal?.removeEventListener('abort', abort);
        }
      };
      const load = (auth: Session | null, preserve = false) => {
        const generation = ++profileRevision;
        const previousProfile = currentProfile;
        if (!preserve) revision++;
        if (!auth || (currentAuth && currentAuth.user.id!==auth.user.id)) {
          void Promise.resolve(workingCopies.clear()).catch(() => {});
          void offlineAccess.clear().catch(()=>{});
        }
        currentAuth = auth;
        if (!preserve) profileReady = false;
        cancel?.abort();
        cancel = new AbortController();
        const requestCancel = cancel;
        if (!preserve) {
          currentProfile=null;queryClient.clear();setSession(null);setProfile(null);setOfflineUntil(null);setOfflineProfile(null);setLoading(Boolean(auth));
        }
        setError(false);
        if (!auth) return;
        const signal = requestCancel.signal;
        const deadline = setTimeout(() => requestCancel.abort(), 10000);
        void apiRequest<unknown>('/v1/me/profile', { method: 'POST', body: {}, accessToken: auth.access_token, signal })
          .then(async value => {
            if (!mounted || profileRevision !== generation) return;
            const verifiedProfile = profileSchema.parse(value);
            if (preserve && previousProfile && profileScope(previousProfile)!==profileScope(verifiedProfile)) {
              revision++;queryClient.clear();await workingCopies.clear();
            }
            await workingCopies.prepare(profileScope(verifiedProfile));
            if (!mounted || profileRevision !== generation) return;
            workingCopies.identify(profileScope(verifiedProfile));currentProfile=verifiedProfile;
            profileReady = true;
            setOfflineUntil(null);setOfflineProfile(null);setProfile(verifiedProfile); setSession(profileSession(verifiedProfile));
            const identity=offlineIdentity(auth.access_token,auth.user.id);
            if(Platform.OS!=='web'&&identity&&verifiedProfile.roles.some(r=>r.code==='ENROLLMENT_AGENT'&&r.organizationId)){
              try{
                const lease=await apiRequest<unknown>('/v1/billing/operations/offline-lease',{method:'POST',body:{},accessToken:auth.access_token,signal});
                if(mounted&&profileRevision===generation)await offlineAccess.save(identity,verifiedProfile,lease);
              }catch(failure){if(mounted&&profileRevision===generation&&failure instanceof ApiError&&[401,403,404].includes(failure.status))await offlineAccess.clear().catch(()=>{});}
            }else await offlineAccess.clear().catch(()=>{});
          })
          .catch(async error => {
            if (!mounted || profileRevision!==generation) return;
            if (error instanceof ApiError && [401,403].includes(error.status)) {load(null);setError(true);return;}
            if(!preserve&&Platform.OS!=='web'){
              try{
                const network=await NetInfo.fetch(),identity=offlineIdentity(auth.access_token,auth.user.id);
                if(identity&&(network.isConnected===false||network.isInternetReachable===false)){
                  const recovery=await offlineAccess.recover(identity);
                  if(recovery&&mounted&&profileRevision===generation){
                    await workingCopies.prepare(profileScope(recovery.profile));
                    if(mounted&&profileRevision===generation){setProfile(null);setOfflineProfile(recovery.profile);setSession(null);setOfflineUntil(recovery.expiresAt);setError(false);return;}
                  }
                }
              }catch{/* Invalid or unavailable ciphertext leaves recovery locked. */}
            }
            if(!preserve)setError(true);
          })
          .finally(() => { clearTimeout(deadline); if (mounted && profileRevision===generation) setLoading(false); });
      };
      refreshRef.current = () => load(currentAuth,profileReady && Boolean(currentAuth));
      clearIdentityRef.current = () => { clearTimeout(timer); load(null); };
      subscription = client.auth.onAuthStateChange((event, auth) => {
        // Defer network work out of Supabase's auth callback/lock.
        clearTimeout(timer);
        if (event==='SIGNED_OUT' || !auth) {load(null);return;}
        timer = setTimeout(() => { if (mounted) load(auth,preserveAuthView(event,currentAuth?.user.id,auth?.user.id,profileReady)); }, 0);
      }).data.subscription;
      if (Platform.OS !== 'web') {
        if (AppState.currentState === 'active') client.auth.startAutoRefresh();
        else client.auth.stopAutoRefresh();
        appState = AppState.addEventListener('change', state => {
          if (state === 'active') { client.auth.startAutoRefresh(); refreshRef.current(); }
          else client.auth.stopAutoRefresh();
        });
      }
    } catch {
      timer = setTimeout(() => { if (mounted) { setError(true); setLoading(false); } }, 0);
    }
    return () => {
      mounted = false; revision++; clearTimeout(timer); cancel?.abort();
      subscription?.unsubscribe(); appState?.remove();
      refreshRef.current = () => {}; clearIdentityRef.current = () => {};
      requestRef.current = async () => { throw new ApiError(401, 'Sign in again.'); };
    };
  }, [queryClient]);

  function setPreviewSection(section: AppSection) {
    if (!runtime.isDemo) throw new Error('Preview identities are disabled in live mode.');
    queryClient.clear();
    setSession({ source: 'design-fixture', subject: 'synthetic-preview',
      sectionGrants: section === 'consumer' ? ['consumer'] : ['consumer', section] });
  }
  async function signInWithEmail(email: string, password: string) {
    if (runtime.isDemo) throw new Error('Live email login is disabled in preview.');
    const { error: authError } = await getSupabaseClient().auth.signInWithPassword({ email: email.trim(), password });
    if (authError) throw new Error('Email sign-in failed.');
  }
  async function signOut() {
    clearIdentityRef.current();
    setSession(null); setProfile(null);setOfflineUntil(null);setOfflineProfile(null); queryClient.clear();
    const cleanupFailed=(await Promise.allSettled([offlineAccess.clear(),Promise.resolve(workingCopies.clear())])).some(result=>result.status==='rejected');
    if (!runtime.isDemo) {
      const { error: authError } = await getSupabaseClient().auth.signOut({ scope: 'local' });
      if (authError) throw new Error('Sign-out failed.');
    }
    if(cleanupFailed)throw new Error('Encrypted recovery cleanup failed.');
  }
  return <SessionContext.Provider value={{ session, profile, loading, error,offlineReadOnly:offlineUntil!==null,offlineProfile, setPreviewSection,
    signInWithEmail, signOut, refreshProfile: () => refreshRef.current(),
    request: (path, options) => requestRef.current(path, options) }}><OfflineSyncBridge/>{children}</SessionContext.Provider>;
}
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within SessionProvider.');
  return value;
}
