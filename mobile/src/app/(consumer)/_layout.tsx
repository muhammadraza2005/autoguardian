import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/SessionProvider';
import { canAccessSection } from '@/features/auth/access';
import { colors } from '@/theme/tokens';
import { AppHeader } from '@/components/ui/Stitch';
import { StitchTabBar } from '@/components/ui/StitchTabBar';
import { runtime } from '@/config/runtime';

export default function ConsumerLayout() {
  const { t } = useTranslation();
  const { session } = useSession();
  if (!runtime.isDemo) return <Redirect href="/live-account" />;
  if (!canAccessSection(session, 'consumer')) return <Redirect href="/welcome" />;
  return (
    <Tabs tabBar={(props) => <StitchTabBar {...props} />} screenOptions={{
      header: ({ route }) => <AppHeader owner={route.name === 'alert-detail'} subtitle={t(route.name === 'alert-detail' ? 'stitch.urgent' : route.name === 'index' ? 'check.title' : route.name === 'my-vehicles' ? 'vehicles.title' : route.name === 'alerts' ? 'alerts.title' : route.name === 'account' ? 'account.title' : 'check.title')} />, headerTitle: t('brand'),
      headerTintColor: colors.primary,
      headerStyle: { backgroundColor: colors.background },
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.textMuted,
      tabBarActiveBackgroundColor: colors.warningBackground,
      tabBarStyle: { backgroundColor: colors.background },
      tabBarItemStyle: { minHeight: 48 },
      tabBarLabelStyle: { fontSize: 12 },
    }}>
      <Tabs.Screen name="index" options={{ title: t('navigation.check'), tabBarIcon: ({ color, size }) => <Ionicons name="search-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="my-vehicles" options={{ title: t('navigation.vehicles'), tabBarIcon: ({ color, size }) => <Ionicons name="car-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="alerts" options={{ title: t('navigation.alerts'), tabBarIcon: ({ color, size }) => <Ionicons name="notifications-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="account" options={{ title: t('navigation.account'), tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="alert-detail" options={{ href: null }} />
      <Tabs.Screen name="fee-summary" options={{ href: null }} />
      <Tabs.Screen name="list-for-sale" options={{ href: null }} />
      <Tabs.Screen name="outcome" options={{ href: null }} />
      <Tabs.Screen name="payment" options={{ href: null }} />
      <Tabs.Screen name="vehicle-detail" options={{ href: null }} />
      <Tabs.Screen name="waiting" options={{ href: null }} />
      <Tabs.Screen name="scan-qr" options={{ href: null }} />
    </Tabs>
  );
}
