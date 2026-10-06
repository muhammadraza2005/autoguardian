import { Redirect, Stack } from 'expo-router';
import { runtime } from '@/config/runtime';
import { useSession } from '@/features/auth/SessionProvider';
import { Copy, StitchPage } from '@/components/ui/Stitch';
import { useTranslation } from 'react-i18next';

export default function VehicleLayout() {
  const { profile, loading, error } = useSession();
  const { t } = useTranslation();
  if (runtime.isDemo) return <Redirect href="/(consumer)/my-vehicles" />;
  if (loading) return <StitchPage><Copy>{t('devAuth.loading')}</Copy></StitchPage>;
  if (error) return <Redirect href="/live-account" />;
  if (!profile) return <Redirect href="/(auth)/sign-in" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
