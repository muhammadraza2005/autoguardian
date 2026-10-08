import { Redirect } from 'expo-router';
import { useSession } from '@/features/auth/SessionProvider';
import { runtime } from '@/config/runtime';
import { connectedAgentRoute } from '@/features/enrollment/wizard';

export default function Index() {
  const { session, profile, loading } = useSession();
  if (loading) return null;
  if (!runtime.isDemo) return <Redirect href={session ? connectedAgentRoute(runtime.developmentEmailAuth, profile) : '/(auth)/sign-in'} />;
  return <Redirect href={session ? '/(consumer)' : '/welcome'} />;
}
