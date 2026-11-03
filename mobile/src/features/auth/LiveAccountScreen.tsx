import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { runtime } from '@/config/runtime';
import { useSession } from '@/features/auth/SessionProvider';
import { AppHeader, StitchPage, Heading, Copy, Card, Label, Action, Notice } from '@/components/ui/Stitch';
import {OfflineSyncQueue} from '@/features/enrollment/OfflineSyncQueue';
import {workingCopies} from '@/features/enrollment/workingCopies';
import {profileScope} from './authEvents';

export default function LiveAccount({embedded=false}:{embedded?:boolean}={}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { profile, loading, error, refreshProfile, signOut,offlineReadOnly,offlineProfile } = useSession();
  const [signOutError, setSignOutError] = useState(false);
  if (runtime.isDemo) return <Redirect href="/(consumer)" />;
  if (!loading && !profile && !error&&!offlineReadOnly) return <Redirect href="/(auth)/sign-in" />;
  async function leave() {
    setSignOutError(false);
    try { await signOut(); } catch { setSignOutError(true); }
  }
  return <View style={{ flex: 1 }}>{!embedded && <AppHeader />}<StitchPage><Heading>{t('devAuth.account')}</Heading>
    {loading && <Copy>{t('devAuth.loading')}</Copy>}
    {offlineReadOnly&&offlineProfile&&<><Notice tone="warning">{t('billing.offlineReadOnly')}</Notice>
      {workingCopies.list(profileScope(offlineProfile)).map(entry=><Card key={entry.copy.kind+entry.id}>
        <Label>{t(entry.copy.kind==='vehicle'?'enrollmentWizard.steps.vehicle':'enrollmentWizard.steps.seals')}</Label>
        <Copy selectable>{entry.id}</Copy>
        {entry.copy.kind==='vehicle'&&<Copy>{entry.copy.fields.chassisIdentifier} · {entry.copy.fields.plate}</Copy>}
      </Card>)}<Action label={t('devAuth.retry')} onPress={refreshProfile}/></>}
    {error && <><Notice tone="danger">{t('devAuth.profileError')}</Notice>
      <Action label={t('devAuth.retry')} onPress={refreshProfile} /></>}
    {profile && <><Notice>{t('devAuth.verified')}</Notice>
      <Card><Label>{t('devAuth.profileId')}</Label><Copy selectable>{profile.id}</Copy>
        <Label>{t('devAuth.tenant')}</Label><Copy selectable>{profile.tenantId}</Copy>
        <Label>{t('devAuth.roles')}</Label>
        <Copy>{profile.roles.length ? profile.roles.map(role => role.code).join(', ') : t('devAuth.noRoles')}</Copy>
      </Card><Action label={t('navigation.vehicles')} icon="car-outline" onPress={() => router.push('/live-vehicles')} />
      <Action label={t('navigation.check')} icon="search-outline" onPress={()=>router.push('/live-checks')}/>
      <Action secondary label={t('billing.title')} onPress={()=>router.push('/billing')}/>
      <Action secondary label={t('billing.liveTitle')} onPress={()=>router.push('/live-billing')}/>
      {profile.roles.some(role=>role.code==='TENANT_ADMIN'&&role.organizationId===null)&&
        <Action secondary label={t('billing.policyTitle')} onPress={()=>router.push('/billing-policy')}/>}
      {profile.roles.some(role=>role.code==='TENANT_ADMIN'&&role.organizationId===null)&&
        <Action secondary label={t('pilotAdministration.title')} onPress={()=>router.push('/pilot-administration')}/>}
      {profile.roles.some(role=>role.code==='ENROLLMENT_AGENT'&&role.organizationId)&&<OfflineSyncQueue/>}
      <Action secondary label={t('m2.reports')} onPress={()=>router.push('/live-checks/reports')}/>
      <Action secondary label={t('relationships.title')} onPress={()=>router.push('/vehicle-relationships')}/>
      {profile.roles.some(role=>role.code==='TENANT_ADMIN'&&role.organizationId===null)&&<Action secondary label={t('pinPolicy.title')} onPress={()=>router.push('/owner-pin-policy')}/>}
      {profile.roles.some(role=>role.code==='OWNER'&&role.organizationId===null)&&<Action secondary label={t('m2.inbox')} onPress={()=>router.push('/live-checks/inbox')}/>}
      {profile.roles.some(role=>role.code==='OWNER'&&role.organizationId===null)&&<Action secondary label={t('ownerPin.title')} onPress={()=>router.push('/owner-pin')}/>}
      {runtime.developmentEmailAuth && profile.roles.some(role=>role.code==='ENROLLMENT_AGENT' && role.organizationId) &&
        <Action secondary label={t('enrollmentWizard.list')} icon="document-text-outline" onPress={()=>router.navigate('/agent')} />}
      {profile.roles.some(role=>role.code==='TENANT_ADMIN'&&role.organizationId===null)&&
        <Action secondary label={t('registrationReview.title')} icon="document-text-outline" onPress={()=>router.push('/registration-reviews')}/>}
      {profile.roles.some(role=>['ENROLLMENT_AGENT','TENANT_ADMIN'].includes(role.code))&&
        <Action secondary label={t('accessSecurity.title')} icon="lock-closed-outline" onPress={()=>router.push('/staff-security')}/>}
      {profile.roles.some(role=>role.code==='OWNER'&&role.organizationId===null)&&
        <Action secondary label={t('ownerConsent.title')} icon="document-text-outline" onPress={()=>router.push('/registration-consents')}/>}
      <Action secondary label={t('devAuth.refresh')} onPress={refreshProfile} /></>}
    {signOutError && <Notice tone="danger">{t('devAuth.signOutError')}</Notice>}
    <Action secondary label={t('devAuth.signOut')} onPress={() => void leave()} />
  </StitchPage></View>;
}
