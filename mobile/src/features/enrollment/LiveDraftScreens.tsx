import { useCallback, useEffect, useRef, useState } from 'react';
import { View, TextInput } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useSession } from '@/features/auth/SessionProvider';
import { ApiError } from '@/services/api/client';
import { AppHeader, Action, Card, Copy, Heading, Label, Notice, StitchPage, stitchStyles } from '@/components/ui/Stitch';
import { draftBodySchema, readDraftPage, readDraft, readOwnerOptions, saveDraft, type EnrollmentDraft, type EnrollmentDraftBody } from './drafts';
import { EvidencePanel } from './EvidencePanel';
import {profileScope} from '@/features/auth/authEvents';
import {workingCopies} from './workingCopies';

function ErrorNotice({error}:{error:unknown}) {
  const {t}=useTranslation();const status=error instanceof ApiError?error.status:undefined;
  const key=status===403?'denied':status===401?'signInAgain':status===404?'unavailable':status===409?'conflict':status===422?'ownerUnavailable':status===400?'invalid':'failed';
  return <Notice tone="danger">{t('liveEnrollment.'+key)}</Notice>;
}
function DraftPage({children}:{children:React.ReactNode}) {
  const {t}=useTranslation();const router=useRouter();
  return <View style={{flex:1}}><AppHeader /><StitchPage>
    {children}
    <Action secondary label={t('ownedVehicles.backAccount')} onPress={()=>router.replace('/live-account')} />
  </StitchPage></View>;
}
export function EnrollmentDraftList() {
  const {t}=useTranslation();const router=useRouter();const {profile,request}=useSession();
  const query=useInfiniteQuery({queryKey:['enrollment-drafts',profile?.tenantId,profile?.id],
    initialPageParam:undefined as string|undefined,queryFn:({pageParam,signal})=>readDraftPage(request,pageParam,signal),
    getNextPageParam:page=>page.nextCursor??undefined,enabled:Boolean(profile),gcTime:0,retry:false,networkMode:'always'});
  const {refetch}=query;useFocusEffect(useCallback(()=>{void refetch();},[refetch]));
  const checking=query.isPending || query.isRefetching;
  const items=!checking && !query.isError?query.data?.pages.flatMap(p=>p.items)??[]:[];
  return <DraftPage><Heading>{t('liveEnrollment.title')}</Heading><Notice tone="warning">{t('liveEnrollment.notice')}</Notice>
    <Action label={t('liveEnrollment.new')} icon="add-outline" onPress={()=>router.push('/live-enrollments/new')} />
    <Action secondary label={t('liveSeals.stock')} icon="cube-outline" onPress={()=>router.push('/live-enrollments/stock')} />
    {checking && <Copy>{t('liveEnrollment.loading')}</Copy>}
    {!checking && query.isError && <ErrorNotice error={query.error} />}
    {!checking && !query.isError && items.length===0 && <Notice>{t('liveEnrollment.empty')}</Notice>}
    {items.map(draft=><Card key={draft.id}><Heading>{draft.vehicle.plate??draft.vehicle.chassisIdentifier}</Heading>
      <Copy>{[draft.vehicle.make,draft.vehicle.model].filter(Boolean).join(' ')}</Copy>
      <Copy>{t('liveEnrollment.draft')} · {t('liveEnrollment.revision',{revision:draft.revision})}</Copy>
      <Action secondary label={t('liveEnrollment.open')} onPress={()=>router.push({pathname:'/live-enrollments/[id]',params:{id:draft.id}})} />
      <Action label={t('liveEvidence.openUploads')} icon="cloud-upload-outline" onPress={()=>router.push({pathname:'/live-enrollments/attachments',params:{id:draft.id}})} />
      <Action secondary label={t('liveSeals.open')} icon="shield-outline" onPress={()=>router.push({pathname:'/live-enrollments/seals',params:{id:draft.id}})} />
    </Card>)}
    {!checking && !query.isError && query.hasNextPage && <Action label={t('ownedVehicles.loadMore')} disabled={query.isFetchingNextPage} onPress={()=>void query.fetchNextPage()} />}
    <Action secondary label={t('liveEnrollment.refresh')} disabled={query.isFetching} onPress={()=>void refetch()} />
  </DraftPage>;
}
export function NewEnrollmentDraft() {return <DraftPage><DraftEditor /></DraftPage>;}
export function EditEnrollmentDraft() {
  const {t}=useTranslation();const router=useRouter();const {id}=useLocalSearchParams<{id?:string|string[]}>();
  const parsed=z.uuid().safeParse(id);const safeId=parsed.success?parsed.data:undefined;
  const {profile,request}=useSession();
  const query=useQuery({queryKey:['enrollment-draft',profile?.tenantId,profile?.id,safeId],
    queryFn:({signal})=>readDraft(request,safeId!,signal),enabled:Boolean(profile && safeId),gcTime:0,retry:false,networkMode:'always',refetchOnWindowFocus:false});
  // Explicit reload preserves unsaved edits during ordinary browser focus changes.
  const {refetch}=query;
  return <DraftPage>
    {!safeId && <Notice tone="danger">{t('liveEnrollment.unavailable')}</Notice>}
    {safeId && query.isFetching && <Copy>{t('liveEnrollment.loading')}</Copy>}
    {safeId && !query.isFetching && query.isError && <ErrorNotice error={query.error} />}
    {safeId && !query.isFetching && !query.isError && query.data && <>
      <Action label={t('liveEvidence.openUploads')} icon="cloud-upload-outline" onPress={()=>router.push({pathname:'/live-enrollments/attachments',params:{id:safeId}})} />
      <Action secondary label={t('liveSeals.open')} icon="shield-outline" onPress={()=>router.push({pathname:'/live-enrollments/seals',params:{id:safeId}})} />
      <DraftEditor key={query.dataUpdatedAt} draft={query.data} />
    </>}
    {safeId && <Action secondary label={t('liveEnrollment.reload')} disabled={query.isFetching} onPress={()=>{
      workingCopies.remove(profile?profileScope(profile):'','vehicle',safeId);void refetch();
    }} />}
    <Action secondary label={t('liveEnrollment.back')} onPress={()=>router.replace('/live-enrollments')} />
  </DraftPage>;
}

export function EnrollmentDraftAttachments() {
  const {t}=useTranslation();const router=useRouter();const {id}=useLocalSearchParams<{id?:string|string[]}>();
  const parsed=z.uuid().safeParse(id);const safeId=parsed.success?parsed.data:undefined;
  const {profile,request}=useSession();
  const query=useQuery({queryKey:['enrollment-draft',profile?.tenantId,profile?.id,safeId],
    queryFn:({signal})=>readDraft(request,safeId!,signal),enabled:Boolean(profile && safeId),gcTime:0,retry:false,networkMode:'always',refetchOnWindowFocus:false});
  return <DraftPage>
    {!safeId && <Notice tone="danger">{t('liveEnrollment.unavailable')}</Notice>}
    {safeId && query.isFetching && <Copy>{t('liveEnrollment.loading')}</Copy>}
    {safeId && !query.isFetching && query.isError && <ErrorNotice error={query.error} />}
    {safeId && !query.isFetching && !query.isError && query.data && <>
      <Heading>{query.data.vehicle.plate??query.data.vehicle.chassisIdentifier}</Heading>
      <EvidencePanel draftId={safeId} />
    </>}
    {safeId && query.isError && <Action secondary label={t('liveEnrollment.reload')} disabled={query.isFetching} onPress={()=>void query.refetch()} />}
    <Action secondary label={t('liveEnrollment.back')} onPress={()=>router.dismissTo('/live-enrollments')} />
  </DraftPage>;
}

function DraftEditor({draft}:{draft?:EnrollmentDraft}) {
  const {t}=useTranslation();const router=useRouter();const cache=useQueryClient();const {profile,request}=useSession();
  const organizations=profile?.roles.filter(r=>r.code==='ENROLLMENT_AGENT' && r.organizationId).map(r=>r.organizationId!)??[];
  const scope=profile?profileScope(profile):'';const copyId=draft?.id??'new';
  const [restored]=useState(()=>{
    const value=workingCopies.read(scope,'vehicle',copyId);
    return value?.kind==='vehicle' && (value.baseRevision===(draft?.revision??null) || value.pending)?value:null;
  });
  const [organization,setOrganization]=useState(restored?.organization??draft?.organizationId??organizations[0]??'');
  const [owner,setOwner]=useState(restored?.owner??draft?.ownerProfileId??'');
  const ownerOptions=useQuery({queryKey:['enrollment-owner-options',profile?.tenantId,profile?.id,organization],
    queryFn:({signal})=>readOwnerOptions(request,organization,signal),enabled:Boolean(profile && organization),
    gcTime:0,retry:false,networkMode:'always',refetchOnWindowFocus:false});
  const ownerAllowed=!ownerOptions.isError && ownerOptions.data?.some(option=>option.profileId===owner);
  const [fields,setFields]=useState(restored?.fields??{chassisIdentifier:draft?.vehicle.chassisIdentifier??'',plate:draft?.vehicle.plate??'',
    category:draft?.vehicle.category??'CAR',make:draft?.vehicle.make??'',model:draft?.vehicle.model??'',
    manufactureYear:draft?.vehicle.manufactureYear?.toString()??'',color:draft?.vehicle.color??''});
  const [key,setKey]=useState(()=>restored?.key??randomUUID());const [invalid,setInvalid]=useState(false);
  const [uncertain,setUncertain]=useState(Boolean(restored?.pending));const finished=useRef(false);
  const attempt=useRef<{body:EnrollmentDraftBody;key:string;revision?:number}|null>(restored?.pending??null);
  const save=useMutation({mutationFn:(submission:{body:EnrollmentDraftBody;key:string;revision?:number})=>saveDraft(request,submission.body,
    draft?{id:draft.id,revision:submission.revision}:{key:submission.key}),
    onSuccess:result=>{
      finished.current=true;workingCopies.remove(scope,'vehicle',copyId);attempt.current=null;setUncertain(false);
      void cache.invalidateQueries({queryKey:['enrollment-drafts',profile?.tenantId,profile?.id]});
      cache.setQueryData(['enrollment-draft',profile?.tenantId,profile?.id,result.id],result);
      router.dismissTo('/live-enrollments');
    },
    onError:error=>{
      const definite=error instanceof ApiError && [400,401,403,404,409,422].includes(error.status);
      setUncertain(!definite);
      if(definite){attempt.current=null;setKey(randomUUID());}
    },
  });
  useEffect(()=>{
    if(!finished.current)workingCopies.write(scope,copyId,{kind:'vehicle',baseRevision:draft?.revision??null,
      organization,owner,fields,key,pending:attempt.current});
  },[scope,copyId,draft?.revision,organization,owner,fields,key,uncertain,save.isPending]);
  const locked=save.isPending || uncertain;
  function submit() {
    setInvalid(false);
    if(attempt.current){save.mutate(attempt.current);return;}
    if(!ownerAllowed){setInvalid(true);return;}
    if(fields.manufactureYear && !/^\d{4}$/.test(fields.manufactureYear)){setInvalid(true);return;}
    const result=draftBodySchema.safeParse({organizationId:organization,ownerProfileId:owner.trim(),vehicle:{...fields,
      plate:fields.plate.trim()||null,make:fields.make.trim()||null,model:fields.model.trim()||null,color:fields.color.trim()||null,
      manufactureYear:fields.manufactureYear?Number(fields.manufactureYear):null}});
    if(!result.success){setInvalid(true);return;}
    attempt.current={body:result.data,key,...(draft?{revision:draft.revision}:{})};save.mutate(attempt.current);
  }
  return <><Heading>{t(draft?'liveEnrollment.edit':'liveEnrollment.new')}</Heading>
    <Copy>{t('liveEnrollment.workingCopy')}</Copy>
    <Notice tone="warning">{t('liveEnrollment.notice')}</Notice>
    {draft && <Notice>{t('liveEnrollment.saved')} · {t('liveEnrollment.revision',{revision:draft.revision})}</Notice>}
    <Card><Label>{t('liveEnrollment.organization')}</Label>
      <Copy selectable>{organization}</Copy>
      {!draft && organizations.length>1 && organizations.map(id=><Action key={id} secondary disabled={locked} label={id} onPress={()=>{setOrganization(id);setOwner('');}} />)}
      <Label>{t('liveEnrollment.owner')}</Label>
      <Copy>{t('liveEnrollment.ownerHint')}</Copy>
      {ownerOptions.isPending && <Copy>{t('liveEnrollment.ownerLoading')}</Copy>}
      {ownerOptions.isError && <ErrorNotice error={ownerOptions.error} />}
      {!ownerOptions.isPending && !ownerOptions.isError && ownerOptions.data?.length===0 && <Notice>{t('liveEnrollment.ownerEmpty')}</Notice>}
      {!ownerOptions.isError && ownerOptions.data?.map(option=><Action key={option.profileId}
        label={t('liveEnrollment.ownerChoice',{number:option.label.slice('Development owner '.length)})}
        icon={owner===option.profileId?'radio-button-on-outline':'radio-button-off-outline'}
        secondary={owner!==option.profileId} disabled={locked} onPress={()=>{setOwner(option.profileId);setInvalid(false);}} />)}
      {Boolean(owner) && !ownerOptions.isPending && !ownerOptions.isError && !ownerAllowed && <Notice tone="warning">{t('liveEnrollment.ownerUnavailable')}</Notice>}
      {ownerAllowed && <Notice tone="warning">{t('liveEnrollment.ownerNotVerified')}</Notice>}
      <Action secondary label={t('liveEnrollment.ownerRefresh')} disabled={locked || ownerOptions.isFetching} onPress={()=>void ownerOptions.refetch()} />
    </Card>
    <Notice>{t(draft?'liveEvidence.openHint':'liveEvidence.saveFirst')}</Notice>
    <Card>{(Object.keys(fields) as (keyof typeof fields)[]).map(field=><View key={field} style={{gap:6}}>
      <Label>{t('liveEnrollment.fields.'+field)}</Label>
      <TextInput accessibilityLabel={t('liveEnrollment.fields.'+field)} style={stitchStyles.input} value={fields[field]}
        onChangeText={value=>setFields(previous=>({...previous,[field]:value}))} editable={!locked}
        keyboardType={field==='manufactureYear'?'number-pad':'default'} autoCorrect={false}
        autoCapitalize={['chassisIdentifier','plate','category'].includes(field)?'characters':'words'} />
    </View>)}</Card>
    {invalid && <Notice tone="danger">{t('liveEnrollment.invalid')}</Notice>}
    {save.isError && <ErrorNotice error={save.error} />}
    {uncertain && <Notice tone="warning">{t('liveEnrollment.uncertain')}</Notice>}
    <Action label={t(save.isPending?'liveEnrollment.saving':uncertain?'liveEnrollment.retrySave':'liveEnrollment.save')} disabled={save.isPending || (!uncertain && !ownerAllowed)} onPress={submit} icon="save-outline" />
    {!draft && <Action secondary label={t('liveEnrollment.back')} onPress={()=>router.replace('/live-enrollments')} />}
  </>;
}
