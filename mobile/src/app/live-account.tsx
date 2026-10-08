import { Redirect } from 'expo-router';
import LiveAccount from '@/features/auth/LiveAccountScreen';
import { useSession } from '@/features/auth/SessionProvider';
import { runtime } from '@/config/runtime';
import { connectedAgentRoute } from '@/features/enrollment/wizard';

export default function AccountRoute() {
  const { profile, loading, error } = useSession();
  const route = connectedAgentRoute(runtime.developmentEmailAuth, profile, 'account');
  if (!loading && !error && route !== '/live-account') return <Redirect href={route} />;
  return <LiveAccount />;
}
