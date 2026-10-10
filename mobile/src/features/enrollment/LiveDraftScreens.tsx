import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View, TextInput } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/SessionProvider';
import { ApiError } from '@/services/api/client';
import { AppHeader, Action, Card, Copy, Heading, Label, Notice, StitchPage, stitchStyles, useRevealField } from '@/components/ui/Stitch';
import { draftBodySchema, readDraftPage, readOwnerOptions, saveDraft, type EnrollmentDraft, type EnrollmentDraftBody } from './drafts';
import {profileScope} from '@/features/auth/authEvents';
import {workingCopies} from './workingCopies';
import {WorkingCopyStatus} from './WorkingCopyStatus';
import { enrollmentRoute } from './wizard';
import { colors } from '@/theme/tokens';

export function ErrorNotice({error}:{error:unknown}) {
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
export function EnrollmentDraftList({embedded=false}:{embedded?:boolean}={}) {
  const {t}=useTranslation();const router=useRouter();const {profile,request}=useSession();
  const query=useInfiniteQuery({queryKey:['enrollment-drafts',profile?.tenantId,profile?.id],
    initialPageParam:undefined as string|undefined,queryFn:({pageParam,signal})=>readDraftPage(request,pageParam,signal),
    getNextPageParam:page=>page.nextCursor??undefined,enabled:Boolean(profile),gcTime:0,retry:false,networkMode:'always',refetchOnWindowFocus:false});
  const {refetch}=query;useFocusEffect(useCallback(()=>{void refetch();},[refetch]));
  const checking=query.isPending || query.isRefetching;
  const items=!checking && !query.isError?query.data?.pages.flatMap(p=>p.items)??[]:[];
  const content=<><Heading>{t('enrollmentWizard.list')}</Heading><Notice tone="warning">{t('enrollmentWizard.notice')}</Notice>
    <Action label={t('enrollmentWizard.new')} icon="add-circle-outline" onPress={()=>router.navigate(enrollmentRoute())} />
    {checking && <Copy>{t('liveEnrollment.loading')}</Copy>}
    {!checking && query.isError && <ErrorNotice error={query.error} />}
    {!checking && !query.isError && items.length===0 && <Notice>{t('liveEnrollment.empty')}</Notice>}
    {items.map(draft=><Card key={draft.id}><Heading>{draft.vehicle.plate??draft.vehicle.chassisIdentifier}</Heading>
      <Copy>{[draft.vehicle.make,draft.vehicle.model].filter(Boolean).join(' ')}</Copy>
      <Copy>{t('liveEnrollment.draft')} · {t('liveEnrollment.revision',{revision:draft.revision})}</Copy>
      <Action label={t('enrollmentWizard.resume')} icon="arrow-forward-outline" onPress={()=>router.navigate(enrollmentRoute('vehicle',draft.id))} />
      <Action secondary label={t('liveReadiness.open')} icon="list-outline" onPress={()=>router.navigate(enrollmentRoute('review',draft.id))} />
    </Card>)}
    {!checking && !query.isError && query.hasNextPage && <Action label={t('ownedVehicles.loadMore')} disabled={query.isFetchingNextPage} onPress={()=>void query.fetchNextPage()} />}
    <Action secondary label={t('liveEnrollment.refresh')} disabled={query.isFetching} onPress={()=>void refetch()} />
  </>;
  return embedded?<StitchPage>{content}</StitchPage>:<DraftPage>{content}</DraftPage>;
}
export function DraftEditor({draft,onSaved,onBusyChange,onDirtyChange}:{draft?:EnrollmentDraft;
  onSaved?:(draft:EnrollmentDraft)=>void;onBusyChange?:(busy:boolean)=>void;onDirtyChange?:(dirty:boolean)=>void}) {
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
  const [key,setKey]=useState(()=>restored?.key??randomUUID());
  const [validationAttempts,setValidationAttempts]=useState(0);const invalid=validationAttempts>0;
  const revealField=useRevealField();const pendingReveal=useRef(false);
  const organizationTarget=useRef<View>(null),ownerTarget=useRef<View>(null);
  const fieldTargets=useRef<Partial<Record<keyof typeof fields,View|null>>>({});
  const inputs=useRef<Partial<Record<keyof typeof fields,TextInput|null>>>({});
  const [uncertain,setUncertain]=useState(Boolean(restored?.pending));const finished=useRef(false);
  const attempt=useRef<{body:EnrollmentDraftBody;key:string;revision?:number}|null>(restored?.pending??null);
  const save=useMutation({mutationFn:async (submission:{body:EnrollmentDraftBody;key:string;revision?:number})=>{
    workingCopies.write(scope,copyId,{kind:'vehicle',baseRevision:draft?.revision??null,
      organization,owner,fields,key,pending:submission});
    await workingCopies.flush();
    return saveDraft(request,submission.body,draft?{id:draft.id,revision:submission.revision}:{key:submission.key});},
    onSuccess:result=>{
      finished.current=true;workingCopies.remove(scope,'vehicle',copyId);attempt.current=null;setUncertain(false);
      void cache.invalidateQueries({queryKey:['enrollment-drafts',profile?.tenantId,profile?.id]});
      cache.setQueryData(['enrollment-draft',profile?.tenantId,profile?.id,result.id],result);
      if(onSaved)onSaved(result);else router.dismissTo('/agent');
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
  const result=draftBodySchema.safeParse({organizationId:organization,ownerProfileId:owner.trim(),vehicle:{...fields,
    plate:fields.plate.trim()||null,make:fields.make.trim()||null,model:fields.model.trim()||null,color:fields.color.trim()||null,
    manufactureYear:fields.manufactureYear?Number(fields.manufactureYear):null}});
  const yearInvalid=Boolean(fields.manufactureYear && !/^\d{4}$/.test(fields.manufactureYear));
  const ownerInvalid=invalid && !ownerAllowed;
  const organizationInvalid=invalid && !result.success && result.error.issues.some(issue=>issue.path[0]==='organizationId');
  const fieldErrors=new Map<keyof typeof fields,{key:string;maximum?:number}>();
  if(invalid && !result.success)for(const issue of result.error.issues){
    if(issue.path[0]!=='vehicle' || typeof issue.path[1]!=='string' || !(issue.path[1] in fields))continue;
    const field=issue.path[1] as keyof typeof fields;
    const key=field==='manufactureYear'?'year':field==='chassisIdentifier' && !fields[field].trim()?'chassisRequired'
      :field==='category' && !fields[field].trim()?'categoryRequired':issue.code==='too_big'?'tooLong':'field';
    fieldErrors.set(field,{key,...(issue.code==='too_big'?{maximum:Number(issue.maximum)}:{})});
  }
  if(invalid && yearInvalid)fieldErrors.set('manufactureYear',{key:'year'});
  // Run after the error messages have been laid out, only for an invalid Save.
  // Typing and background query updates must never steal focus.
  useLayoutEffect(()=>{
    if(!pendingReveal.current)return;
    pendingReveal.current=false;
    if(organizationInvalid){revealField(organizationTarget.current);return;}
    if(ownerInvalid){revealField(ownerTarget.current);return;}
    const first=(Object.keys(fields) as (keyof typeof fields)[]).find(field=>fieldErrors.has(field));
    if(first)revealField(fieldTargets.current[first]??null,inputs.current[first]);
  });
  const callbacks=useRef({onBusyChange,onDirtyChange});
  useEffect(()=>{callbacks.current={onBusyChange,onDirtyChange};},[onBusyChange,onDirtyChange]);
  const dirty=!draft || organization!==draft.organizationId || owner!==draft.ownerProfileId
    || Object.entries(fields).some(([field,value])=>value!==(draft.vehicle[field as keyof typeof draft.vehicle]?.toString()??''));
  useEffect(()=>{callbacks.current.onBusyChange?.(locked);callbacks.current.onDirtyChange?.(dirty);},[locked,dirty]);
  useEffect(()=>()=>{callbacks.current.onBusyChange?.(false);callbacks.current.onDirtyChange?.(false);},[]);
  function submit() {
    if(attempt.current){save.mutate(attempt.current);return;}
    setValidationAttempts(value=>value+1);
    if(!ownerAllowed || yearInvalid || !result.success){pendingReveal.current=true;return;}
    attempt.current={body:result.data,key,...(draft?{revision:draft.revision}:{})};save.mutate(attempt.current);
  }
  return <>
    <WorkingCopyStatus />
    <Notice tone="warning">{t('liveEnrollment.notice')}</Notice>
    {draft && <Notice>{t('liveEnrollment.saved')} · {t('liveEnrollment.revision',{revision:draft.revision})}</Notice>}
    <Card style={ownerInvalid || organizationInvalid?{borderColor:colors.danger,borderWidth:2}:undefined}>
      <View ref={organizationTarget} collapsable={false} style={{gap:14}}><Label>{t('liveEnrollment.organization')}</Label>
      <Copy>{t('enrollmentWizard.organization',{number:organizations.indexOf(organization)+1})}</Copy>
      {organizationInvalid && <Notice tone="danger">{t('liveEnrollment.validation.organization')}</Notice>}
      {!draft && organizations.length>1 && organizations.map((id,index)=><Action key={id} secondary disabled={locked}
        label={t('enrollmentWizard.organization',{number:index+1})} onPress={()=>{setOrganization(id);setOwner('');}} />)}</View>
      <View ref={ownerTarget} collapsable={false} style={{gap:14}}>
      <Label style={ownerInvalid?{color:colors.danger}:undefined}>{t('liveEnrollment.owner')}</Label>
      <Copy>{t('liveEnrollment.ownerHint')}</Copy>
      {ownerInvalid && <Notice tone="danger">{t('liveEnrollment.validation.owner')}</Notice>}
      {ownerOptions.isPending && <Copy>{t('liveEnrollment.ownerLoading')}</Copy>}
      {ownerOptions.isError && <ErrorNotice error={ownerOptions.error} />}
      {!ownerOptions.isPending && !ownerOptions.isError && ownerOptions.data?.length===0 && <Notice>{t('liveEnrollment.ownerEmpty')}</Notice>}
      {!ownerOptions.isError && ownerOptions.data?.map(option=><Action key={option.profileId}
        label={t('liveEnrollment.ownerChoice',{number:option.label.slice('Development owner '.length)})}
        icon={owner===option.profileId?'radio-button-on-outline':'radio-button-off-outline'}
        secondary={owner!==option.profileId} disabled={locked} onPress={()=>setOwner(option.profileId)} />)}
      {Boolean(owner) && !ownerOptions.isPending && !ownerOptions.isError && !ownerAllowed && <Notice tone="warning">{t('liveEnrollment.ownerUnavailable')}</Notice>}
      {ownerAllowed && <Notice tone="warning">{t('liveEnrollment.ownerNotVerified')}</Notice>}
      <Action secondary label={t('liveEnrollment.ownerRefresh')} disabled={locked || ownerOptions.isFetching} onPress={()=>void ownerOptions.refetch()} /></View>
    </Card>
    <Notice>{t(draft?'liveEvidence.openHint':'liveEvidence.saveFirst')}</Notice>
    <Card>{(Object.keys(fields) as (keyof typeof fields)[]).map(field=><View key={field} collapsable={false}
      ref={node=>{fieldTargets.current[field]=node;}} style={{gap:6}}>
      <Label style={fieldErrors.has(field)?{color:colors.danger}:undefined}>{t('liveEnrollment.fields.'+field)}</Label>
      <TextInput ref={node=>{inputs.current[field]=node;}} accessibilityLabel={t('liveEnrollment.fields.'+field)} style={[stitchStyles.input,fieldErrors.has(field) && {borderColor:colors.danger,borderWidth:2}]} value={fields[field]}
        onChangeText={value=>setFields(previous=>({...previous,[field]:value}))} editable={!locked}
        keyboardType={field==='manufactureYear'?'number-pad':'default'} autoCorrect={false}
        autoCapitalize={['chassisIdentifier','plate','category'].includes(field)?'characters':'words'} />
      {fieldErrors.has(field) && <Notice tone="danger">{t('liveEnrollment.validation.'+fieldErrors.get(field)!.key,{
        field:t('liveEnrollment.fields.'+field),maximum:fieldErrors.get(field)!.maximum,
      })}</Notice>}
    </View>)}</Card>
    {invalid && (fieldErrors.size>0 || ownerInvalid || organizationInvalid) && <Notice tone="danger">{t('liveEnrollment.validation.review')}</Notice>}
    {save.isError && <ErrorNotice error={save.error} />}
    {uncertain && <Notice tone="warning">{t('liveEnrollment.uncertain')}</Notice>}
    <Action label={t(save.isPending?'liveEnrollment.saving':uncertain?'liveEnrollment.retrySave':onSaved?'enrollmentWizard.saveNext':'liveEnrollment.save')} disabled={save.isPending || (!uncertain && ownerOptions.isFetching)} onPress={submit} icon="save-outline" />
  </>;
}
