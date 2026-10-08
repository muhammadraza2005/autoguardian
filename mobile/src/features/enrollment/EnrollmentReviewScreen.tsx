import { useCallback } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useSession } from '@/features/auth/SessionProvider';
import { ApiError } from '@/services/api/client';
import { Action, AppHeader, Card, Copy, DetailRow, Heading, Label, Notice, StitchPage } from '@/components/ui/Stitch';
import { readReadiness, sampleCheckCodes, productionCheckCodes, type EnrollmentReadiness } from './readiness';
import { enrollmentRoute } from './wizard';

export default function EnrollmentReviewScreen({embedded=false}:{embedded?:boolean}={}) {
  const { t } = useTranslation(); const router = useRouter(); const { profile, request } = useSession();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const parsed = z.uuid().safeParse(id); const safeId = parsed.success ? parsed.data : undefined;
  const hasProfile = Boolean(profile);
  const query = useQuery({ queryKey: ['enrollment-readiness', profile?.tenantId, profile?.id, safeId],
    queryFn: ({ signal }) => readReadiness(request, safeId!, signal), enabled: Boolean(hasProfile && safeId),
    gcTime: 0, retry: false, networkMode: 'always', refetchOnWindowFocus: false });
  const { refetch } = query;
  // Auth refresh replaces the profile object. It must not act like route navigation.
  useFocusEffect(useCallback(() => { if (hasProfile && safeId) void refetch(); }, [hasProfile, safeId, refetch]));
  const loading = query.isPending || query.isFetching;
  const data = !loading && !query.isError ? query.data : undefined;
  const status = query.error instanceof ApiError ? query.error.status : undefined;
  const errorKey = status === 503 ? 'setup' : status === 401 ? 'signInAgain' : status === 403 ? 'denied'
    : status === 404 ? 'unavailable' : 'failed';
  function checklist(codes: readonly string[], value: EnrollmentReadiness) {
    return codes.map(code => {
      const check = value.checks.find(item => item.code === code)!;
      return <View key={code} style={{ gap: 6 }}>
        <Label>{t('liveReadiness.checks.' + code + '.title')}</Label>
        <Copy>{t('liveReadiness.statuses.' + check.status)}</Copy>
        <Copy>{t('liveReadiness.checks.' + code + '.hint')}</Copy>
      </View>;
    });
  }
  const content=<>
    <Heading>{t('liveReadiness.title')}</Heading>
    <Notice tone="warning">{t('liveReadiness.notice')}</Notice>
    {!safeId && <Notice tone="danger">{t('liveEnrollment.unavailable')}</Notice>}
    {safeId && loading && <Copy>{t('liveEnrollment.loading')}</Copy>}
    {safeId && !loading && query.isError && <Notice tone="danger">{t(errorKey === 'setup' ? 'liveReadiness.setup' : 'liveEnrollment.' + errorKey)}</Notice>}
    {data && <>
      {!embedded && <Card><Heading>{data.vehicle.plate ?? data.vehicle.chassisIdentifier}</Heading>
        <DetailRow label={t('liveEnrollment.fields.chassisIdentifier')} value={data.vehicle.chassisIdentifier} />
        <DetailRow label={t('liveEnrollment.fields.category')} value={data.vehicle.category} />
        <Copy>{t('liveEnrollment.revision', { revision: data.draftRevision })}</Copy>
        <DetailRow label={t('liveReadiness.package')} value={data.package === null ? t('liveReadiness.noPackage') : t('liveSeals.packages.' + data.package)} />
      </Card>}
      {embedded && <DetailRow label={t('liveReadiness.package')} value={data.package === null ? t('liveReadiness.noPackage') : t('liveSeals.packages.' + data.package)} />}
      <Heading>{t('liveReadiness.samples')}</Heading>
      <Copy>{t('liveReadiness.savedOnly')}</Copy>
      <Card>{checklist(sampleCheckCodes, data)}</Card>
      <Action secondary label={t('liveOwner.open')} onPress={() => router.setParams(enrollmentRoute('owner',safeId!).params)} />
      <Action secondary label={t('liveEnrollment.open')} onPress={() => router.setParams(enrollmentRoute('vehicle',safeId!).params)} />
      <Action secondary label={t('liveEvidence.openUploads')} onPress={() => router.setParams(enrollmentRoute('documents',safeId!).params)} />
      <Action secondary label={t('liveSeals.open')} onPress={() => router.setParams(enrollmentRoute('seals',safeId!).params)} />
      <Heading>{t('liveReadiness.production')}</Heading>
      <Card>{checklist(productionCheckCodes, data)}</Card>
      <Notice tone="warning">{t('liveReadiness.blocked')}</Notice>
      <Action label={t('liveReadiness.submitUnavailable')} disabled onPress={() => {}} />
    </>}
    {safeId && <Action secondary label={t('liveReadiness.refresh')} disabled={loading} onPress={() => void refetch()} />}
    {!embedded && <Action secondary label={t('liveEnrollment.back')} onPress={() => router.dismissTo('/agent')} />}
  </>;
  return embedded?content:<View style={{flex:1}}><AppHeader/><StitchPage>{content}</StitchPage></View>;
}
