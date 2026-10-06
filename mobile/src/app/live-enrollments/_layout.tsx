import { Redirect, Stack } from 'expo-router';
import { runtime } from '@/config/runtime';
import { useSession } from '@/features/auth/SessionProvider';
import { Copy, StitchPage } from '@/components/ui/Stitch';
import { useTranslation } from 'react-i18next';

export default function DraftLayout() {
  const { profile,loading,error }=useSession();const {t}=useTranslation();
  if(!runtime.developmentEmailAuth) return <Redirect href="/live-account" />;
  if(loading) return <StitchPage><Copy>{t('devAuth.loading')}</Copy></StitchPage>;
  if(error) return <Redirect href="/live-account" />;
  if(!profile) return <Redirect href="/(auth)/sign-in" />;
  if(!profile.roles.some(r=>r.code==='ENROLLMENT_AGENT' && r.organizationId)) return <Redirect href="/live-account" />;
  return <Stack screenOptions={{headerShown:false}} />;
}
