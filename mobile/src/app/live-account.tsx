import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { runtime } from '@/config/runtime';
import { useSession } from '@/features/auth/SessionProvider';
import { AppHeader, StitchPage, Heading, Copy, Card, Label, Action, Notice } from '@/components/ui/Stitch';

export default function LiveAccount() {
  const { t } = useTranslation();
  const router = useRouter();
  const { profile, loading, error, refreshProfile, signOut } = useSession();
  const [signOutError, setSignOutError] = useState(false);
  if (runtime.isDemo) return <Redirect href="/(consumer)" />;
  if (!loading && !profile && !error) return <Redirect href="/(auth)/sign-in" />;
  async function leave() {
    setSignOutError(false);
    try { await signOut(); } catch { setSignOutError(true); }
  }
  return <View style={{ flex: 1 }}><AppHeader /><StitchPage><Heading>{t('devAuth.account')}</Heading>
    {loading && <Copy>{t('devAuth.loading')}</Copy>}
    {error && <><Notice tone="danger">{t('devAuth.profileError')}</Notice>
      <Action label={t('devAuth.retry')} onPress={refreshProfile} /></>}
    {profile && <><Notice>{t('devAuth.verified')}</Notice>
      <Card><Label>{t('devAuth.profileId')}</Label><Copy selectable>{profile.id}</Copy>
        <Label>{t('devAuth.tenant')}</Label><Copy selectable>{profile.tenantId}</Copy>
        <Label>{t('devAuth.roles')}</Label>
        <Copy>{profile.roles.length ? profile.roles.map(role => role.code).join(', ') : t('devAuth.noRoles')}</Copy>
      </Card><Action label={t('navigation.vehicles')} icon="car-outline" onPress={() => router.push('/live-vehicles')} />
      {runtime.developmentEmailAuth && profile.roles.some(role=>role.code==='ENROLLMENT_AGENT' && role.organizationId) &&
        <Action secondary label={t('liveEnrollment.title')} icon="document-text-outline" onPress={()=>router.push('/live-enrollments')} />}
      <Action secondary label={t('devAuth.refresh')} onPress={refreshProfile} /></>}
    {signOutError && <Notice tone="danger">{t('devAuth.signOutError')}</Notice>}
    <Action secondary label={t('devAuth.signOut')} onPress={() => void leave()} />
  </StitchPage></View>;
}
