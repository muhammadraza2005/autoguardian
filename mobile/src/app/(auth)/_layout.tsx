import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { runtime } from '@/config/runtime';
import { Screen } from '@/components/ui/Screen';
import { AppText } from '@/components/ui/AppText';
import { AppHeader } from '@/components/ui/Stitch';

export default function AuthLayout() {
  const { t } = useTranslation();
  if (!runtime.isDemo && !runtime.developmentEmailAuth) {
    return <Screen><AppText variant="heading">{t('access.title')}</AppText><AppText>{t('welcome.description')}</AppText></Screen>;
  }
  return <Stack screenOptions={{ header: () => <AppHeader subtitle={t('stitch.protection')} /> }}>
    <Stack.Screen name="sign-in" options={{headerShown:false}} />
    <Stack.Screen name="verify-otp" options={{headerShown:false}} />
  </Stack>;
}
