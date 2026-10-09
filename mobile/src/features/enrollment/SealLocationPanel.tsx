import { useEffect, useRef, useState } from 'react';
import { TextInput } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/SessionProvider';
import { ApiError } from '@/services/api/client';
import { Action, Card, Copy, Heading, Label, Notice, stitchStyles } from '@/components/ui/Stitch';
import { readSealLocations, saveSealLocations, sealLocationBody, type SealLocationBody, type SealLocations } from './sealLocations';

type Props = { draftId: string; refreshKey?: number; readOnly?: boolean; disabled?: boolean;
  onBusyChange?: (busy: boolean) => void; onDirtyChange?: (dirty: boolean) => void };
function errorKey(error: unknown) {
  const status = error instanceof ApiError ? error.status : undefined;
  return status === 503 ? 'setup' : status === 409 ? 'conflict' : status === 401 || status === 403 ? 'denied' : 'failed';
}
export function SealLocationPanel({ draftId, refreshKey, readOnly = false, disabled = false, onBusyChange, onDirtyChange }: Props) {
  const { t } = useTranslation(); const { profile, request } = useSession();
  const query = useQuery({ queryKey: ['seal-locations', profile?.tenantId, profile?.id, draftId],
    queryFn: ({ signal }) => readSealLocations(request, draftId, signal), enabled: Boolean(profile),
    gcTime: 0, retry: false, networkMode: 'always', refetchOnWindowFocus: false });
  const { refetch } = query;
  useEffect(() => { if (refreshKey !== undefined) void refetch(); }, [refreshKey, refetch]);
  const loading = query.isPending || query.isFetching;
  const value = !loading && !query.isError ? query.data : undefined;
  return <Card><Heading>{t('sealLocations.title')}</Heading><Copy>{t('sealLocations.notice')}</Copy>
    {loading && <Copy>{t('sealLocations.loading')}</Copy>}
    {query.isError && <Notice tone="danger">{t('sealLocations.' + errorKey(query.error))}</Notice>}
    {value && <>
      <Notice tone={value.complete ? 'neutral' : 'warning'}>{t('sealLocations.' + (!value.required ? 'none' : value.complete ? 'complete' : 'missing'))}</Notice>
      {readOnly ? value.locations.map(item => <Copy key={item.position}>{t('sealLocations.label', { number: item.position })}: {item.description}</Copy>)
        : value.required && <LocationEditor key={query.dataUpdatedAt} value={value} disabled={disabled}
          onBusyChange={onBusyChange} onDirtyChange={onDirtyChange} onReload={() => void refetch()} />}
    </>}
    {readOnly && <Action secondary label={t('liveReadiness.refresh')} disabled={loading} onPress={() => void refetch()} />}
    {!readOnly && query.isError && <Action secondary label={t('liveReadiness.refresh')} disabled={loading || disabled} onPress={() => void refetch()} />}
  </Card>;
}

function LocationEditor({ value, disabled, onBusyChange, onDirtyChange, onReload }: {
  value: SealLocations; disabled: boolean; onBusyChange?: Props['onBusyChange']; onDirtyChange?: Props['onDirtyChange']; onReload: () => void;
}) {
  const { t } = useTranslation(); const { profile, request } = useSession(); const cache = useQueryClient();
  const baseline = [1, 2, 3, 4].map(position => value.locations.find(item => item.position === position)?.description ?? '');
  const [descriptions, setDescriptions] = useState(baseline), [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false), [error, setError] = useState<unknown>(null), [invalid, setInvalid] = useState(false);
  const attempt = useRef<{ key: string; body: SealLocationBody } | null>(null), mounted = useRef(true), inFlight = useRef(false);
  const callbacks = useRef({ onBusyChange, onDirtyChange });
  useEffect(() => { callbacks.current = { onBusyChange, onDirtyChange }; }, [onBusyChange, onDirtyChange]);
  const dirty = descriptions.some((description, index) => description !== baseline[index]);
  useEffect(() => { callbacks.current.onBusyChange?.(busy || uncertain); callbacks.current.onDirtyChange?.(dirty); }, [busy, uncertain, dirty]);
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; callbacks.current.onBusyChange?.(false); callbacks.current.onDirtyChange?.(false);
  }; }, []);
  async function save() {
    if (inFlight.current || disabled) return;
    if (!attempt.current) {
      const parsed = sealLocationBody.safeParse({ expectedDraftRevision: value.draftRevision,
        expectedFittingRevision: value.fittingRevision, expectedLocationRevision: value.locationRevision,
        locations: descriptions.map((description, index) => ({ position: index + 1, description })) });
      if (!parsed.success) { setInvalid(true); return; }
      attempt.current = { key: randomUUID(), body: parsed.data };
    }
    const pending = attempt.current; inFlight.current = true; setBusy(true); setError(null); setInvalid(false);
    try {
      const result = await saveSealLocations(request, value.draftId, pending.key, pending.body);
      if (!mounted.current) return;
      attempt.current = null; setUncertain(false);
      cache.setQueryData(['seal-locations', profile?.tenantId, profile?.id, value.draftId], result);
    } catch (failure) {
      if (!mounted.current) return;
      const definite = failure instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(failure.status);
      if (definite) attempt.current = null;
      setUncertain(!definite); setError(failure);
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  const locked = disabled || busy || uncertain;
  return <>
    <Copy>{t('sealLocations.hint')}</Copy>
    {value.fittingRevision === 0 && <Notice>{t('sealLocations.saveFirst')}</Notice>}
    {descriptions.map((description, index) => <Card key={index}>
      <Label>{t('sealLocations.label', { number: index + 1 })}</Label>
      <TextInput accessibilityLabel={t('sealLocations.label', { number: index + 1 })} value={description}
        style={stitchStyles.input} maxLength={200} editable={!locked && value.fittingRevision > 0}
        onChangeText={text => { setDescriptions(previous => previous.map((item, position) => position === index ? text : item)); setInvalid(false); setError(null); }} />
    </Card>)}
    {invalid && <Notice tone="danger">{t('sealLocations.invalid')}</Notice>}
    {Boolean(error) && <Notice tone="danger">{t('sealLocations.' + errorKey(error))}</Notice>}
    {uncertain && <Notice tone="warning">{t('sealLocations.uncertain')}</Notice>}
    {dirty && <Copy>{t('sealLocations.unsaved')}</Copy>}
    <Action label={t('sealLocations.' + (busy ? 'saving' : uncertain ? 'retry' : 'save'))} icon="save-outline"
      disabled={disabled || busy || value.fittingRevision === 0 || (!dirty && !uncertain)} onPress={() => void save()} />
    <Action secondary label={t('sealLocations.reload')} disabled={disabled || busy} onPress={onReload} />
  </>;
}
