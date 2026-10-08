import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/SessionProvider';
import { canAccessSection } from '@/features/auth/access';
import { colors } from '@/theme/tokens';
import { AppHeader, Copy, StitchPage } from '@/components/ui/Stitch';
import { StitchTabBar } from '@/components/ui/StitchTabBar';
import { runtime } from '@/config/runtime';
import { developmentAgentAllowed } from '@/features/enrollment/wizard';

export default function SectionLayout() {
  const { t } = useTranslation();
  const { session, profile, loading, error } = useSession();
  if(!runtime.isDemo && loading)return <StitchPage><Copy>{t('devAuth.loading')}</Copy></StitchPage>;
  if(!runtime.isDemo && (error || !profile))return <Redirect href="/live-account"/>;
  if (!(runtime.isDemo ? canAccessSection(session, 'agent') : developmentAgentAllowed(runtime.developmentEmailAuth,profile)))
    return <Redirect href="/permission-denied" />;
  
  return (
    <Tabs tabBar={(props) => <StitchTabBar {...props} accent />} screenOptions={{
      header: () => <AppHeader subtitle={t('stitch.agentMode')} />, headerTitle: 'AutoGuardian (Agent)',
      headerTintColor: colors.primary,
      headerStyle: { backgroundColor: colors.background },
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.textMuted,
      tabBarActiveBackgroundColor: colors.surface,
      tabBarStyle: { backgroundColor: colors.background },
      tabBarItemStyle: { minHeight: 48 },
      tabBarLabelStyle: { fontSize: 12 },
    }}>
      <Tabs.Screen name="index" options={{ title: t('navigation.enrollments'), tabBarIcon: ({ color, size }) => <Ionicons name="list-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="new-enrollment" options={{ title: t('navigation.enrollment'), tabBarIcon: ({ color, size }) => <Ionicons name="add-circle-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="seal-stock" options={{ title: t('navigation.stock'), tabBarIcon: ({ color, size }) => <Ionicons name="cube-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="account" options={{ title: t('navigation.account'), tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} /> }} />
    </Tabs>
  );
}
