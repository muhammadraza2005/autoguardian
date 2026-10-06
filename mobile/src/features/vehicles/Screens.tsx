import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/SessionProvider';
import { ApiError } from '@/services/api/client';
import { AppHeader, StitchPage, Heading, Copy, Card, Label, Action, Notice } from '@/components/ui/Stitch';
import { colors } from '@/theme/tokens';
import { readVehiclePage, readVehicleDetail, vehicleIdSchema, type OwnedVehicle } from './contracts';

function VehicleSummary({ vehicle }: { vehicle: OwnedVehicle }) {
  const { t } = useTranslation();
  const name = [vehicle.make, vehicle.model, vehicle.manufactureYear].filter(value => value !== null).join(' ');
  return <>
    <Heading>{vehicle.plate ?? t('ownedVehicles.noPlate')}</Heading>
    {name.length > 0 && <Copy style={s.body}>{name}</Copy>}
    <Label style={s.body}>{t('ownedVehicles.saleStatus')}</Label>
    <Copy style={s.body}>{t('ownedVehicles.sales.' + vehicle.saleStatus)}</Copy>
    <Label style={s.body}>{t('ownedVehicles.recordStatus')}</Label>
    <Copy style={s.body}>{t('ownedVehicles.records.' + vehicle.recordStatus)}</Copy>
  </>;
}

function ReadError({ error, retry }: { error: unknown; retry: () => void }) {
  const { t } = useTranslation();
  const status = error instanceof ApiError ? error.status : undefined;
  const key = status === 401 ? 'signInAgain' : status === 403 ? 'accessDenied' : status === 404 ? 'unavailable' : 'loadError';
  return <><Notice tone="danger">{t('ownedVehicles.' + key)}</Notice>
    {status !== 401 && status !== 403 && <Action label={t('devAuth.retry')} onPress={retry} />}
  </>;
}

export function OwnedVehiclesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { profile, request } = useSession();
  const query = useInfiniteQuery({
    queryKey: ['owned-vehicles', profile?.tenantId, profile?.id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => readVehiclePage(request, pageParam, signal),
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled: Boolean(profile), gcTime: 0, retry: false, networkMode: 'always', refetchOnWindowFocus: 'always',
  });
  const { refetch } = query;
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));
  // Hide old results during a fresh ownership check and after any failed check.
  const checking = query.isPending || query.isRefetching;
  const vehicles = !checking && !query.isError ? query.data?.pages.flatMap(page => page.items) ?? [] : [];
  return <View style={s.page}><AppHeader /><StitchPage>
    <Heading>{t('navigation.vehicles')}</Heading>
    <Copy style={s.body}>{t('ownedVehicles.description')}</Copy>
    {checking && <Copy style={s.body} accessibilityLiveRegion="polite">{t('ownedVehicles.loading')}</Copy>}
    {!checking && query.isError && <ReadError error={query.error} retry={() => void refetch()} />}
    {!checking && !query.isError && vehicles.length === 0 && <Notice>{t('ownedVehicles.empty')}</Notice>}
    {vehicles.map(vehicle => <Card key={vehicle.id}>
      <VehicleSummary vehicle={vehicle} />
      <Action secondary label={t('ownedVehicles.viewDetails')} icon="chevron-forward" onPress={() => router.push({ pathname: '/live-vehicles/[id]', params: { id: vehicle.id } })} />
    </Card>)}
    {!checking && !query.isError && query.hasNextPage && <Action label={t(query.isFetchingNextPage ? 'ownedVehicles.loading' : 'ownedVehicles.loadMore')} disabled={query.isFetchingNextPage} onPress={() => void query.fetchNextPage()} />}
    <Action secondary disabled={query.isFetching} label={t('ownedVehicles.refresh')} onPress={() => void refetch()} />
    <Action secondary label={t('ownedVehicles.backAccount')} onPress={() => router.replace('/live-account')} />
  </StitchPage></View>;
}

export function OwnedVehicleDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const parsed = vehicleIdSchema.safeParse(params.id);
  const id = parsed.success ? parsed.data : undefined;
  const { profile, request } = useSession();
  const query = useQuery({
    queryKey: ['owned-vehicle', profile?.tenantId, profile?.id, id],
    queryFn: ({ signal }) => readVehicleDetail(request, id!, signal),
    enabled: Boolean(profile && id), gcTime: 0, retry: false, networkMode: 'always', refetchOnWindowFocus: 'always',
  });
  const { refetch } = query;
  useFocusEffect(useCallback(() => { if (id) void refetch(); }, [id, refetch]));
  const checking = Boolean(id) && query.isFetching;
  const vehicle = id && !checking && !query.isError ? query.data : undefined;
  const fields = vehicle ? [
    ['chassis', vehicle.chassisIdentifier], ['category', vehicle.category],
    ['make', vehicle.make], ['model', vehicle.model], ['year', vehicle.manufactureYear], ['color', vehicle.color],
  ] as const : [];
  return <View style={s.page}><AppHeader /><StitchPage>
    <Heading>{t('ownedVehicles.detailTitle')}</Heading>
    {!id && <Notice tone="danger">{t('ownedVehicles.unavailable')}</Notice>}
    {checking && <Copy style={s.body} accessibilityLiveRegion="polite">{t('ownedVehicles.loading')}</Copy>}
    {id && !checking && query.isError && <ReadError error={query.error} retry={() => void refetch()} />}
    {vehicle && <>
      <Card><VehicleSummary vehicle={vehicle} /></Card>
      {vehicle.recordStatus === 'PENDING_REVIEW' && <Notice tone="warning">{t('ownedVehicles.pendingReview')}</Notice>}
      <Card>{fields.map(([key, value]) => <View key={key} style={s.field}>
        <Label style={s.body}>{t('ownedVehicles.' + key)}</Label>
        <Copy selectable style={s.body}>{value === null ? t('ownedVehicles.notProvided') : key === 'category' ? t('ownedVehicles.categories.' + value, { defaultValue: String(value) }) : String(value)}</Copy>
      </View>)}</Card>
    </>}
    {id && <Action secondary disabled={checking} label={t('ownedVehicles.refresh')} onPress={() => void refetch()} />}
    <Action secondary label={t('ownedVehicles.backVehicles')} onPress={() => router.replace('/live-vehicles')} />
    <Action secondary label={t('ownedVehicles.backAccount')} onPress={() => router.replace('/live-account')} />
  </StitchPage></View>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  body: { fontSize: 16, lineHeight: 24 },
  field: { gap: 4, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
});
