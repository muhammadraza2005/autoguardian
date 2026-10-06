import { Redirect } from 'expo-router';
import { useSession } from '@/features/auth/SessionProvider';
import { runtime } from '@/config/runtime';

export default function Index() {
  const { session, loading } = useSession();
  if (loading) return null;
  if (!runtime.isDemo) return <Redirect href={session ? '/live-account' : '/(auth)/sign-in'} />;
  return <Redirect href={session ? '/(consumer)' : '/welcome'} />;
}
