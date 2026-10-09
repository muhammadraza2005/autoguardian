import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/SessionProvider';
import { ApiError } from '@/services/api/client';
import { Action, Card, Copy, Heading, Notice } from '@/components/ui/Stitch';
import { correctionReasons, readEvidenceReviews, saveEvidenceReview, type EvidenceReviewBody } from './evidenceReviews';
import { readEvidence } from './evidence';

export function EvidenceReviewPanel({ draftId, refreshKey, onBusyChange }: { draftId: string; refreshKey: number; onBusyChange?: (busy: boolean) => void }) {
  const { t } = useTranslation(); const { profile, request } = useSession(); const cache = useQueryClient();
  const queryKey = ['evidence-reviews', profile?.tenantId, profile?.id, draftId];
  const query = useQuery({ queryKey, queryFn: ({ signal }) => readEvidenceReviews(request, draftId, signal),
    enabled: Boolean(profile), gcTime: 0, retry: false, networkMode: 'always', refetchOnWindowFocus: false });
  const { refetch } = query;
  useEffect(() => { void refetch(); }, [refreshKey, refetch]);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState<unknown>(null);
  const attempt = useRef<{ key: string; attachmentId: string; body: EvidenceReviewBody } | null>(null);
  const mounted = useRef(true), inFlight = useRef(false);
  const downloadAbort = useRef<AbortController | null>(null);
  const callback = useRef(onBusyChange);
  useEffect(() => { callback.current = onBusyChange; }, [onBusyChange]);
  useEffect(() => { callback.current?.(busy || uncertain); }, [busy, uncertain]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; downloadAbort.current?.abort(); callback.current?.(false); }; }, []);
  const loading = query.isPending || query.isFetching;
  const value = !loading && !query.isError ? query.data : undefined;
  const locked = loading || busy || uncertain || Platform.OS !== 'web';
  function errorKey(failure: unknown) {
    const status = failure instanceof ApiError ? failure.status : undefined;
    return status === 503 ? 'setup' : status === 409 ? 'conflict' : status === 401 || status === 403 ? 'denied' : 'failed';
  }
  async function save(attachmentId?: string, decision?: EvidenceReviewBody['decision'], reason: EvidenceReviewBody['reason'] = null) {
    if (inFlight.current) return;
    if (!attempt.current) {
      if (!value || !attachmentId || !decision || locked) return;
      const item = value.items.find(item => item.attachmentId === attachmentId);
      if (!item || item.uploadStatus !== 'STAGED') return;
      attempt.current = { key: randomUUID(), attachmentId, body: { expectedDraftRevision: value.draftRevision,
        expectedReviewRevision: item.reviewRevision, decision, reason } };
    }
    const pending = attempt.current; inFlight.current = true; setBusy(true); setError(null);
    try {
      const result = await saveEvidenceReview(request, draftId, pending.attachmentId, pending.key, pending.body);
      if (!mounted.current) return;
      attempt.current = null; setUncertain(false); cache.setQueryData(queryKey, result);
    } catch (failure) {
      if (!mounted.current) return;
      const definite = failure instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(failure.status);
      if (definite) attempt.current = null;
      setUncertain(!definite); setError(failure);
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  async function download(attachmentId: string) {
    if (locked || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); downloadAbort.current = new AbortController();
    try {
      const file = await readEvidence(request, draftId, attachmentId, downloadAbort.current.signal);
      if (!mounted.current) return;
      const bytes = Uint8Array.from(atob(file.dataBase64), char => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
      try {
        const link = document.createElement('a'); link.href = url;
        link.download = 'sample-evidence.' + (file.mimeType === 'application/pdf' ? 'pdf' : file.mimeType === 'image/png' ? 'png' : 'jpg');
        link.click();
      } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (failure) { if (mounted.current) setError(failure); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  return <Card><Heading>{t('evidenceReview.title')}</Heading><Notice>{t('evidenceReview.notice')}</Notice>
    <Copy>{t('evidenceReview.inspectFirst')}</Copy>
    {Platform.OS !== 'web' && <Notice>{t('evidenceReview.nativePending')}</Notice>}
    {loading && <Copy>{t('evidenceReview.loading')}</Copy>}
    {query.isError && <Notice tone="danger">{t('evidenceReview.' + errorKey(query.error))}</Notice>}
    {Boolean(error) && <Notice tone="danger">{t('evidenceReview.' + errorKey(error))}</Notice>}
    {uncertain && <><Notice tone="warning">{t('evidenceReview.uncertain')}</Notice>
      <Action label={t('evidenceReview.retry')} disabled={busy} onPress={() => void save()} /></>}
    {value?.items.length === 0 && <Copy>{t('evidenceReview.empty')}</Copy>}
    {value?.items.map((item, index) => <Card key={item.attachmentId}>
      <Heading>{index + 1}. {t('liveEvidence.kinds.' + item.kind)}</Heading>
      <Copy>{t('evidenceReview.decisions.' + item.decision)}</Copy>
      {item.reason && <Notice tone="warning">{t('evidenceReview.reasons.' + item.reason)}</Notice>}
      {item.uploadStatus === 'PENDING' ? <Copy>{t('evidenceReview.pending')}</Copy> : <>
        <Action secondary label={t('liveEvidence.download')} disabled={locked} onPress={() => void download(item.attachmentId)} />
        <Action label={t('evidenceReview.accept')} disabled={locked || item.decision === 'ACCEPTED_SAMPLE'}
          onPress={() => void save(item.attachmentId, 'ACCEPTED_SAMPLE')} />
        {correctionReasons.map(reason => <Action key={reason} secondary label={t('evidenceReview.correct', { reason: t('evidenceReview.reasons.' + reason) })}
          disabled={locked || item.reason === reason} onPress={() => void save(item.attachmentId, 'NEEDS_CORRECTION', reason)} />)}
      </>}
    </Card>)}
    <Action secondary label={t(uncertain ? 'evidenceReview.discard' : 'liveReadiness.refresh')} disabled={busy || loading}
      onPress={() => { attempt.current = null; setUncertain(false); setError(null); void refetch(); }} />
  </Card>;
}
