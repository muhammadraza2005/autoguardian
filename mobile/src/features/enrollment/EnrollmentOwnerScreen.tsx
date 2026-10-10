import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useSession } from '@/features/auth/SessionProvider';
import { ApiError } from '@/services/api/client';
import { Action, AppHeader, Card, Copy, Heading, Label, Notice, StitchPage, stitchStyles } from '@/components/ui/Stitch';
import { ownerDetailsSchema, readOwner, saveOwner, recordOwnerConsent, type OwnerSnapshot } from './owner';
import {loadOwnerRecovery,saveOwnerRecovery,removeOwnerRecovery} from './ownerRecovery';
import type {OwnerAttempt,OwnerRecovery} from './ownerRecoverySchema';

function OwnerError({ error }: { error: unknown }) {
  const { t } = useTranslation(); const status = error instanceof ApiError ? error.status : undefined;
  return <Notice tone="danger">{t(status === 503 ? 'liveOwner.setup' : 'liveEnrollment.' +
    (status === 403 ? 'denied' : status === 404 ? 'unavailable' : status === 401 ? 'signInAgain' : status === 409 ? 'conflict' : status === 422 ? 'ownerUnavailable' : 'failed'))}</Notice>;
}
export default function EnrollmentOwnerScreen({embedded=false,onBusyChange,onDirtyChange}:{embedded?:boolean;
  onBusyChange?:(busy:boolean)=>void;onDirtyChange?:(dirty:boolean)=>void}={}) {
  const { t } = useTranslation(); const router = useRouter(); const { profile, request } = useSession();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>(); const parsed = z.uuid().safeParse(id);
  const safeId = parsed.success ? parsed.data : undefined;
  const query = useQuery({ queryKey: ['enrollment-owner', profile?.tenantId, profile?.id, safeId],
    queryFn: ({ signal }) => readOwner(request, safeId!, signal), enabled: Boolean(profile && safeId), gcTime: 0,
    retry: false, networkMode: 'always', refetchOnWindowFocus: false });
  const [busy, setBusy] = useState(false);
  const content=<><Heading>{t('liveOwner.title')}</Heading>
    <Notice tone="warning">{t('liveOwner.notice')}</Notice>
    {!safeId && <Notice tone="danger">{t('liveEnrollment.unavailable')}</Notice>}
    {safeId && query.isFetching && <Copy>{t('liveEnrollment.loading')}</Copy>}
    {safeId && !query.isFetching && query.isError && <OwnerError error={query.error} />}
    {profile && safeId && !query.isFetching && !query.isError && query.data &&
      <OwnerForm key={[profile.tenantId, profile.id, safeId, query.dataUpdatedAt].join(':')} snapshot={query.data}
        onBusy={setBusy} onBusyChange={onBusyChange} onDirtyChange={onDirtyChange} />}
    {safeId && <Action secondary label={t('liveOwner.reload')} disabled={busy || query.isFetching} onPress={() => {
      void removeOwnerRecovery(safeId).then(()=>query.refetch()).catch(()=>{});
    }} />}
    {!embedded && safeId && <Action secondary label={t('liveOwner.back')} disabled={busy} onPress={() => router.dismissTo({ pathname: '/live-enrollments/review', params: { id: safeId } })} />}
  </>;
  return embedded?content:<View style={{flex:1}}><AppHeader/><StitchPage>{content}</StitchPage></View>;
}
type Attempt = OwnerAttempt;
function OwnerForm({ snapshot, onBusy, onBusyChange, onDirtyChange }: { snapshot: OwnerSnapshot; onBusy: (busy: boolean) => void;
  onBusyChange?:(busy:boolean)=>void;onDirtyChange?:(dirty:boolean)=>void }) {
  const { t } = useTranslation(); const { profile, request } = useSession(); const cache = useQueryClient();
  const [type, setType] = useState<'INDIVIDUAL' | 'COMPANY'>(snapshot.details?.type ?? 'INDIVIDUAL');
  const [language, setLanguage] = useState<'en' | 'fr'>(snapshot.details?.preferredLanguage ?? 'en');
  const [fields, setFields] = useState({ name: snapshot.details?.name ?? '', companyRegistration: snapshot.details?.companyRegistration ?? '',
    representativeName: snapshot.details?.representativeName ?? '', idDocumentType: snapshot.details?.idDocumentType ?? '',
    idDocumentNumber: snapshot.details?.idDocumentNumber ?? '', phone: snapshot.details?.phone ?? '' });
  const [terms, setTerms] = useState(false), [data, setData] = useState(false);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<unknown>(null); const attempt = useRef<Attempt | null>(null);
  const [restoring,setRestoring]=useState(Platform.OS!=='web'),[recoveryFailed,setRecoveryFailed]=useState(false);
  const [recoveryUnavailable,setRecoveryUnavailable]=useState(false);
  const saved=useRef(false);
  const pending = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; attempt.current = null; }; }, []);
  const locked = busy || uncertain || restoring || recoveryUnavailable;
  const document = snapshot.documents.find(d => d.language === snapshot.details?.preferredLanguage);
  const parsed = ownerDetailsSchema.safeParse({ ...fields, type, preferredLanguage: language,
    companyRegistration: type === 'COMPANY' ? fields.companyRegistration : null, representativeName: type === 'COMPANY' ? fields.representativeName : null });
  const invalidFields = invalid && !parsed.success ? new Set(parsed.error.issues.map(issue => issue.path[0])) : new Set();
  const dirty = !parsed.success || JSON.stringify(parsed.data) !== JSON.stringify(snapshot.details);
  const callbacks=useRef({onBusyChange,onDirtyChange});
  useEffect(()=>{callbacks.current={onBusyChange,onDirtyChange};},[onBusyChange,onDirtyChange]);
  const unsaved=(dirty && (snapshot.details!==null || Object.values(fields).some(Boolean)))
    || (snapshot.consent?.status!=='RECORDED' && (terms || data));
  useEffect(()=>{callbacks.current.onBusyChange?.(locked);callbacks.current.onDirtyChange?.(unsaved);},[locked,unsaved]);
  useEffect(()=>()=>{callbacks.current.onBusyChange?.(false);callbacks.current.onDirtyChange?.(false);},[]);
  useEffect(()=>{
    if(Platform.OS==='web')return;
    let active=true;
    void loadOwnerRecovery(snapshot.draftId).then(value=>{
      if(!active || !value || value.ownerProfileId!==snapshot.ownerProfileId)return;
      if(!value.pending && (value.draftRevision!==snapshot.draftRevision || value.ownerGeneration!==snapshot.ownerGeneration))return;
      setType(value.type);setLanguage(value.language);setFields(value.fields);setTerms(value.terms);setData(value.data);
      attempt.current=value.pending;setUncertain(Boolean(value.pending));
    }).catch(()=>{if(active){setRecoveryFailed(true);setRecoveryUnavailable(true);}}).finally(()=>{if(active)setRestoring(false);});
    return()=>{active=false;};
  },[snapshot.draftId,snapshot.draftRevision,snapshot.ownerGeneration,snapshot.ownerProfileId]);
  const recovery=useMemo<Omit<OwnerRecovery,'pending'>>(()=>({draftRevision:snapshot.draftRevision,
    ownerGeneration:snapshot.ownerGeneration,ownerProfileId:snapshot.ownerProfileId,type,language,fields,terms,data}),
    [snapshot.draftRevision,snapshot.ownerGeneration,snapshot.ownerProfileId,type,language,fields,terms,data]);
  useEffect(()=>{
    if(restoring || recoveryUnavailable || saved.current || Platform.OS==='web')return;
    void saveOwnerRecovery(snapshot.draftId,{...recovery,pending:attempt.current}).then(()=>{if(mounted.current)setRecoveryFailed(false);})
      .catch(()=>{if(mounted.current)setRecoveryFailed(true);});
  },[snapshot.draftId,recovery,restoring,recoveryUnavailable,uncertain,busy]);
  async function send(value: Attempt) {
    if (pending.current) return;
    pending.current = true; attempt.current = value; setBusy(true); onBusy(true); setError(null); setInvalid(false);
    try {
      if(Platform.OS!=='web')await saveOwnerRecovery(snapshot.draftId,{...recovery,pending:value});
      const result = value.kind === 'details' ? await saveOwner(request, snapshot.draftId, value.key, value.body)
        : await recordOwnerConsent(request, snapshot.draftId, value.key, value.body);
      if (!mounted.current) return;
      saved.current=true;await removeOwnerRecovery(snapshot.draftId);if(!mounted.current)return;
      // Web owner forms stay in memory. Native recovery is encrypted separately.
      for (const key of ['enrollment-draft', 'enrollment-drafts', 'enrollment-readiness', 'enrollment-evidence', 'seal-fitting'])
        void cache.invalidateQueries({ queryKey: [key, profile?.tenantId, profile?.id] });
      attempt.current = null; setUncertain(false);
      cache.setQueryData(['enrollment-owner', profile?.tenantId, profile?.id, snapshot.draftId], result);
    } catch (failure) {
      if (!mounted.current) return;
      setError(failure);
      const definite = failure instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(failure.status);
      setUncertain(!definite); if (definite) attempt.current = null;
      if (failure instanceof ApiError && [401, 403, 404, 422].includes(failure.status)) {
        // Drop the saved identity snapshot as soon as its authorization fails.
        void cache.resetQueries({ queryKey: ['enrollment-owner', profile?.tenantId, profile?.id, snapshot.draftId], exact: true });
      }
    } finally { pending.current = false; if (mounted.current) setBusy(false); onBusy(false); }
  }
  function save() {
    if (!parsed.success) { setInvalid(true); return; }
    void send({ kind: 'details', key: randomUUID(), body: { expectedDraftRevision: snapshot.draftRevision, details: parsed.data } });
  }
  function consent(accept: boolean) {
    if (!document || dirty || !snapshot.details) return;
    void send({ kind: 'consent', key: randomUUID(), body: { expectedDraftRevision: snapshot.draftRevision, ownerGeneration: snapshot.ownerGeneration,
      version: document.version, language: document.language, ...(accept ? { accept: true, termsAccepted: true, dataAccepted: true } : { accept: false }) } });
  }
  return <><Copy>{t(Platform.OS==='web'?'liveOwner.memory':'liveOwner.nativeRecovery')}</Copy>
    {recoveryFailed && <Notice tone="danger">{t('liveEnrollment.nativeRecoveryFailed')}</Notice>}<Card>
    {(['INDIVIDUAL', 'COMPANY'] as const).map(value => <Action key={value} secondary={type !== value} disabled={locked}
      label={t('liveOwner.' + (value === 'COMPANY' ? 'company' : 'individual'))} onPress={() => setType(value)} />)}
    {(Object.keys(fields) as (keyof typeof fields)[]).filter(field => type === 'COMPANY' || !['companyRegistration', 'representativeName'].includes(field)).map(field =>
      <View key={field} style={{ gap: 6 }}><Label>{t('liveOwner.fields.' + field)}</Label>
        <TextInput accessibilityLabel={t('liveOwner.fields.' + field)} style={stitchStyles.input} value={fields[field]} editable={!locked}
          onChangeText={value => setFields(previous => ({ ...previous, [field]: value }))} autoCorrect={false} autoComplete="off"
          keyboardType={field === 'phone' ? 'phone-pad' : 'default'}
          maxLength={field === 'phone' ? 16 : field === 'idDocumentType' ? 64 : ['idDocumentNumber', 'companyRegistration'].includes(field) ? 100 : 200} />
        {field === 'phone' && <Copy>{t('liveOwner.phoneHint')}</Copy>}
        {invalidFields.has(field) && <Notice tone="danger">{t(field === 'phone' ? 'liveOwner.invalidPhone' : 'liveOwner.invalidField', {
          field: t('liveOwner.fields.' + field),
        })}</Notice>}
      </View>)}
    <Label>{t('liveOwner.fields.preferredLanguage')}</Label>
    {(['fr', 'en'] as const).map(value => <Action key={value} secondary={language !== value} disabled={locked} label={t('liveOwner.' + value)} onPress={() => setLanguage(value)} />)}
    {invalid && <Notice tone="danger">{t('liveOwner.invalid')}</Notice>}
    {snapshot.details && <Notice>{t('liveOwner.saved')}</Notice>}
    <Action label={t(busy ? 'liveOwner.saving' : !dirty && snapshot.details ? 'liveOwner.saved' : 'liveOwner.save')} disabled={locked || (!dirty && Boolean(snapshot.details))} onPress={save} />
  </Card><Notice tone="warning">{t('liveOwner.phonePending')}</Notice>
    <Heading>{t('liveOwner.consentTitle')}</Heading><Notice>{t('liveOwner.consentNotice')}</Notice>
    {(!document || dirty) && <Notice>{t('liveOwner.saveFirst')}</Notice>}
    {document && !dirty && <Card><Copy>{document.version} · {document.language.toUpperCase()}</Copy>
      <Label>{t('liveOwner.terms')}</Label><Copy>{document.termsText}</Copy>
      <Action secondary={!terms} disabled={locked} icon={terms ? 'checkbox-outline' : 'square-outline'} label={t('liveOwner.agreeTerms')} onPress={() => setTerms(!terms)} />
      <Label>{t('liveOwner.data')}</Label><Copy>{document.dataText}</Copy>
      <Action secondary={!data} disabled={locked} icon={data ? 'checkbox-outline' : 'square-outline'} label={t('liveOwner.agreeData')} onPress={() => setData(!data)} />
      <Action label={t('liveOwner.record')} disabled={locked || !terms || !data || snapshot.consent?.status === 'RECORDED'} onPress={() => consent(true)} />
      {snapshot.consent?.status === 'RECORDED' && <Action secondary label={t('liveOwner.withdraw')} disabled={locked} onPress={() => consent(false)} />}
    </Card>}
    {snapshot.consent && <Notice>{t('liveOwner.' + (snapshot.consent.status === 'RECORDED' ? 'recorded' : 'withdrawn'), {
      actor: snapshot.consent.recordedByProfileId, time: snapshot.consent.recordedAt, version: snapshot.consent.version, language: snapshot.consent.language.toUpperCase() })}</Notice>}
    {error != null && <OwnerError error={error} />}
    {uncertain && <><Notice tone="warning">{t('liveOwner.uncertain')}</Notice>
      <Action label={t('liveOwner.retry')} disabled={busy} onPress={() => { if (attempt.current) void send(attempt.current); }} /></>}
  </>;
}
