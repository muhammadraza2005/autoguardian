import {useEffect,useRef,useState} from 'react';
import {View} from 'react-native';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {useInfiniteQuery,useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {randomUUID} from 'expo-crypto';
import {useTranslation} from 'react-i18next';
import {z} from 'zod';
import {useSession} from '@/features/auth/SessionProvider';
import {ApiError} from '@/services/api/client';
import {Action,AppHeader,Card,Copy,DetailRow,Heading,Label,Notice,StitchPage} from '@/components/ui/Stitch';
import {readDraft} from './drafts';
import {EvidencePanel} from './EvidencePanel';
import {listEvidence,type evidenceMetadata} from './evidence';
import {readSealFitting,readSealStock,saveSealFitting,sealFittingBodySchema,type SealFitting,type SealFittingBody,type SealPackage} from './seals';
import {availableSealChoices} from './sealChoices';
import {profileScope} from '@/features/auth/authEvents';
import {workingCopies} from './workingCopies';
import { colors } from '@/theme/tokens';

function SealPage({children}:{children:React.ReactNode}){
  const {t}=useTranslation();const router=useRouter();
  return <View style={{flex:1}}><AppHeader/><StitchPage>{children}
    <Action secondary label={t('liveSeals.back')} onPress={()=>router.dismissTo('/live-enrollments')}/>
  </StitchPage></View>;
}
function SealError({error}:{error:unknown}){
  const {t}=useTranslation();const status=error instanceof ApiError?error.status:undefined;
  return <Notice tone="danger">{t('liveSeals.'+(status===503?'setup':status===403||status===401?'denied':status===404?'unavailable':status===409?'conflict':status===422?'selectionUnavailable':status===400?'invalid':'failed'))}</Notice>;
}
export function DevelopmentSealStock({embedded=false}:{embedded?:boolean}={}){
  const {t}=useTranslation();const {profile,request}=useSession();
  const {organizationId}=useLocalSearchParams<{organizationId?:string|string[]}>();
  const organizations=[...new Set(profile?.roles.filter(r=>r.code==='ENROLLMENT_AGENT' && r.organizationId).map(r=>r.organizationId!)??[])];
  const [organization,setOrganization]=useState(typeof organizationId==='string'?organizationId:organizations[0]??'');
  const allowed=z.uuid().safeParse(organization).success && organizations.includes(organization);
  const query=useInfiniteQuery({queryKey:['seal-stock',profile?.tenantId,profile?.id,organization],initialPageParam:undefined as string|undefined,
    queryFn:({pageParam,signal})=>readSealStock(request,organization,pageParam,signal),getNextPageParam:page=>page.nextCursor??undefined,
    enabled:Boolean(profile && allowed),gcTime:0,retry:false,networkMode:'always',refetchOnWindowFocus:false});
  const items=!query.isError?query.data?.pages.flatMap(page=>page.items)??[]:[];
  const content=<><Heading>{t('liveSeals.stock')}</Heading><Notice tone="warning">{t('liveSeals.notice')}</Notice>
    {organizations.length>1 && <Card><Label>{t('liveSeals.organization')}</Label>{organizations.map(org=><Action key={org} secondary={org!==organization}
      label={t('enrollmentWizard.organization',{number:organizations.indexOf(org)+1})} onPress={()=>setOrganization(org)}/>)}</Card>}
    {!allowed && <Notice tone="danger">{t('liveSeals.denied')}</Notice>}
    {allowed && query.isPending && <Copy>{t('liveSeals.loading')}</Copy>}
    {allowed && query.isError && <SealError error={query.error}/>}
    {allowed && !query.isPending && !query.isError && items.length===0 && <Notice>{t('liveSeals.emptyStock')}</Notice>}
    {items.map(seal=><Card key={seal.id}><Copy selectable>{seal.code}</Copy><Copy>{t('liveSeals.types.'+seal.type)}</Copy>
      <DetailRow label={t('liveSeals.batch')} value={seal.batchCode}/>
      <Copy>{t(seal.status!=='IN_STOCK'?'liveSeals.statuses.'+seal.status:seal.available?'liveSeals.available':'liveSeals.reserved')}</Copy>
    </Card>)}
    {query.hasNextPage && <Action secondary label={t('liveSeals.loadMore')} disabled={query.isFetching} onPress={()=>void query.fetchNextPage()}/>}
    {allowed && <Action secondary label={t('liveSeals.refreshStock')} disabled={query.isFetching} onPress={()=>void query.refetch()}/>}
  </>;
  return embedded?<StitchPage>{content}</StitchPage>:<SealPage>{content}</SealPage>;
}
export function EnrollmentSealFitting({embedded=false,onSaved,onBusyChange,onDirtyChange}:{embedded?:boolean;
  onSaved?:(result:SealFitting)=>void;onBusyChange?:(busy:boolean)=>void;onDirtyChange?:(dirty:boolean)=>void}={}){
  const {t}=useTranslation();const router=useRouter();const {profile,request}=useSession();
  const {id}=useLocalSearchParams<{id?:string|string[]}>();const parsed=z.uuid().safeParse(id);const safeId=parsed.success?parsed.data:undefined;
  const draft=useQuery({queryKey:['enrollment-draft',profile?.tenantId,profile?.id,safeId],queryFn:({signal})=>readDraft(request,safeId!,signal),
    enabled:Boolean(profile && safeId),gcTime:0,retry:false,networkMode:'always',refetchOnWindowFocus:false});
  const fitting=useQuery({queryKey:['seal-fitting',profile?.tenantId,profile?.id,safeId],queryFn:({signal})=>readSealFitting(request,safeId!,signal),
    enabled:Boolean(profile && safeId),gcTime:0,retry:false,networkMode:'always',refetchOnWindowFocus:false});
  const evidence=useQuery({queryKey:['enrollment-evidence',profile?.tenantId,profile?.id,safeId],queryFn:({signal})=>listEvidence(request,safeId!,signal),
    enabled:Boolean(profile && safeId && fitting.data && !fitting.isError),gcTime:0,retry:false,networkMode:'always',refetchOnWindowFocus:false});
  const loading=draft.isFetching || fitting.isFetching;const error=draft.error??fitting.error;
  const content=<><Heading>{t('liveSeals.title')}</Heading><Notice tone="warning">{t('liveSeals.notice')}</Notice>
    {!safeId && <Notice tone="danger">{t('liveSeals.unavailable')}</Notice>}
    {Boolean(safeId) && loading && <Copy>{t('liveSeals.loading')}</Copy>}
    {Boolean(safeId) && !loading && Boolean(error) && <SealError error={error}/>}
    {safeId && !loading && !error && draft.data && fitting.data && <>
      <Heading>{draft.data.vehicle.plate??draft.data.vehicle.chassisIdentifier}</Heading>
      <Copy>{t('liveSeals.codeExplanation')}</Copy>
      <Action secondary label={t('liveSeals.stock')} icon="cube-outline" onPress={()=>router.navigate({pathname:'/agent/seal-stock',params:{organizationId:draft.data.organizationId}})}/>
      <FittingEditor key={fitting.dataUpdatedAt} fitting={fitting.data} organizationId={draft.data.organizationId}
        onSaved={onSaved} onBusyChange={onBusyChange} onDirtyChange={onDirtyChange}
        photos={evidence.isError?[]:evidence.data?.items.filter(p=>p.kind==='SEAL_FITTING_PHOTO' && p.status==='STAGED')??[]}/>
      {!embedded && <Card><Heading>{t('liveSeals.progress')}</Heading>
        <DetailRow label={t('liveSeals.metadata')} value={t('liveSeals.complete')}/>
        <DetailRow label={t('liveSeals.documents')} value={t(fitting.data.sampleDocumentsSaved?'liveSeals.complete':'liveSeals.pending')}/>
        <DetailRow label={t('liveSeals.fitting')} value={t(fitting.data.sealDraftComplete?'liveSeals.complete':'liveSeals.pending')}/>
        <DetailRow label={t('liveSeals.owner')} value={t('liveSeals.pending')}/>
        <DetailRow label={t('liveSeals.payment')} value={t('liveSeals.pending')}/>
        <Notice>{t('liveSeals.inactive')}</Notice>
      </Card>}
    </>}
    {safeId && <Action secondary label={t('liveSeals.reload')} disabled={loading} onPress={()=>{
      workingCopies.remove(profile?profileScope(profile):'','seals',safeId);void draft.refetch();void fitting.refetch();void evidence.refetch();
    }}/>}
  </>;
  return embedded?content:<SealPage>{content}</SealPage>;
}
function FittingEditor({fitting,photos,organizationId,onSaved,onBusyChange,onDirtyChange}:{fitting:SealFitting;
  photos:z.infer<typeof evidenceMetadata>[];organizationId:string;onSaved?:(result:SealFitting)=>void;
  onBusyChange?:(busy:boolean)=>void;onDirtyChange?:(dirty:boolean)=>void}){
  const {t}=useTranslation();const router=useRouter();const cache=useQueryClient();const {profile,request}=useSession();
  const scope=profile?profileScope(profile):'';
  const [restored]=useState(()=>{
    const value=workingCopies.read(scope,'seals',fitting.draftId);
    return value?.kind==='seals' && ((value.draftRevision===fitting.draftRevision && value.fittingRevision===fitting.fittingRevision) || value.pending)?value:null;
  });
  const [chosen,setChosen]=useState<SealPackage|null>(restored?.package??fitting.package);
  const [slots,setSlots]=useState(()=>restored?.slots??[1,2,3,4].map(position=>{
    const saved=fitting.placements.find(p=>p.position===position);return {position,sealCode:saved?.sealCode??'',photoId:saved?.photoId??null};
  }));
  const stock=useInfiniteQuery({queryKey:['seal-stock',profile?.tenantId,profile?.id,organizationId],initialPageParam:undefined as string|undefined,
    queryFn:({pageParam,signal})=>readSealStock(request,organizationId,pageParam,signal),getNextPageParam:page=>page.nextCursor??undefined,
    enabled:Boolean(profile),gcTime:0,retry:false,networkMode:'always',refetchOnWindowFocus:false});
  const seals=stock.isError?[]:stock.data?.pages.flatMap(page=>page.items)??[];
  const [sealPicker,setSealPicker]=useState<number|null>(null);const [photoPicker,setPhotoPicker]=useState<number|null>(null);
  const [problem,setProblem]=useState<{key:string;position?:number}|null>(null);const [uncertain,setUncertain]=useState(Boolean(restored?.pending));
  const [uploading,setUploading]=useState<Record<number,boolean>>({});const [newPhotos,setNewPhotos]=useState<z.infer<typeof evidenceMetadata>[]>([]);
  const allPhotos=[...new Map([...photos,...newPhotos].map(p=>[p.id,p])).values()];
  const finished=useRef(false);const attempt=useRef<{key:string;body:SealFittingBody}|null>(restored?.pending??null);
  const save=useMutation({mutationFn:(value:{key:string;body:SealFittingBody})=>saveSealFitting(request,fitting.draftId,value.key,value.body),
    onSuccess:result=>{finished.current=true;workingCopies.remove(scope,'seals',fitting.draftId);attempt.current=null;setUncertain(false);
      cache.setQueryData(['seal-fitting',profile?.tenantId,profile?.id,result.draftId],result);
      void cache.invalidateQueries({queryKey:['seal-stock',profile?.tenantId,profile?.id]});
      void cache.invalidateQueries({queryKey:['enrollment-readiness',profile?.tenantId,profile?.id]});
      if(onSaved)onSaved(result);else router.dismissTo('/agent');},
    onError:error=>{const definite=error instanceof ApiError && [400,401,403,404,409,422,503].includes(error.status);
      setUncertain(!definite);if(definite)attempt.current=null;}});
  const locked=save.isPending || uncertain || Object.values(uploading).some(Boolean);
  const callbacks=useRef({onBusyChange,onDirtyChange});
  useEffect(()=>{callbacks.current={onBusyChange,onDirtyChange};},[onBusyChange,onDirtyChange]);
  const dirty=chosen!==fitting.package || slots.some(slot=>{
    const saved=fitting.placements.find(p=>p.position===slot.position);
    return slot.sealCode!==(saved?.sealCode??'') || slot.photoId!==(saved?.photoId??null);
  });
  useEffect(()=>{callbacks.current.onBusyChange?.(locked);callbacks.current.onDirtyChange?.(dirty);},[locked,dirty]);
  useEffect(()=>()=>{callbacks.current.onBusyChange?.(false);callbacks.current.onDirtyChange?.(false);},[]);
  useEffect(()=>{
    if(!finished.current)workingCopies.write(scope,fitting.draftId,{kind:'seals',draftRevision:fitting.draftRevision,
      fittingRevision:fitting.fittingRevision,package:chosen,slots,pending:attempt.current});
  },[scope,fitting.draftId,fitting.draftRevision,fitting.fittingRevision,chosen,slots,uncertain,save.isPending]);
  function submit(){
    setProblem(null);if(attempt.current){save.mutate(attempt.current);return;}
    const missing=slots.find(s=>!s.sealCode.trim() && s.photoId);
    if(missing){setProblem({key:'chooseSealFirst',position:missing.position});return;}
    const parsed=sealFittingBodySchema.safeParse({package:chosen,placements:chosen==='NONE'?[]:slots.filter(s=>s.sealCode.trim()),
      expectedDraftRevision:fitting.draftRevision,expectedFittingRevision:fitting.fittingRevision});
    if(!parsed.success){setProblem({key:'invalid'});return;}
    attempt.current={key:randomUUID(),body:parsed.data};save.mutate(attempt.current);
  }
  return <>
    <Copy>{t('liveEnrollment.workingCopy')}</Copy>
    {fitting.package!==null && !fitting.current && <Notice tone="warning">{t('liveSeals.stale')}</Notice>}
    <Card><Heading>{t('liveSeals.selectPackage')}</Heading><Copy>{t('liveSeals.packageChange')}</Copy>
      {(['NONE','STANDARD','ONE_ALARM','FOUR_ALARMS'] as const).map(p=><Action key={p} label={t('liveSeals.packages.'+p)} secondary={p!==chosen}
        icon={p===chosen?'radio-button-on-outline':'radio-button-off-outline'} disabled={locked} onPress={()=>{
          if(p!==chosen){setChosen(p);setSlots(previous=>previous.map(s=>({...s,sealCode:'',photoId:null})));setPhotoPicker(null);setSealPicker(null);setProblem(null);}
        }}/>)}</Card>
    {chosen!==null && chosen!=='NONE' && <>
      <Heading>{t('liveSeals.slots')}</Heading><Copy>{t('liveSeals.slotsHint')}</Copy>
      <Copy>{t('liveSeals.counts',{count:slots.filter(s=>s.sealCode.trim()).length,total:4})}</Copy>
      <Notice>{t('liveSeals.partialHint')}</Notice>
      {stock.isError && <SealError error={stock.error}/>}
      {slots.map(slot=>{
        const choices=availableSealChoices(chosen,slot.position,slots,seals,fitting.placements);
        const complete=Boolean(slot.sealCode && slot.photoId && allPhotos.some(p=>p.id===slot.photoId));
        return <Card key={slot.position} style={{borderColor:complete?colors.border:colors.primary,borderWidth:complete?1:2}}>
        <Heading>{t('liveSeals.position',{number:slot.position})}</Heading>
        <Notice icon={complete?'checkmark-circle-outline':'ellipsis-horizontal-circle-outline'} tone={complete?'neutral':'warning'}>
          {t(complete?'liveSeals.photoAttached':'enrollmentWizard.needsWork')}</Notice>
        <Label>{t('liveSeals.code')}</Label><Copy>{t('liveSeals.codeHint')}</Copy>
        <Copy selectable>{slot.sealCode||t('liveSeals.noSeal')}</Copy>
        <Action secondary label={t(slot.sealCode?'liveSeals.changeSeal':'liveSeals.chooseSeal')} disabled={locked || stock.isPending || stock.isError}
          onPress={()=>setSealPicker(sealPicker===slot.position?null:slot.position)}/>
        {sealPicker===slot.position && <>
          {choices.length===0 && <Notice>{t('liveSeals.noMatchingSeals')}</Notice>}
          {choices.map(seal=><Action key={seal.code} secondary={seal.code!==slot.sealCode} disabled={locked}
            label={t('liveSeals.types.'+seal.type)+' — '+seal.code} onPress={()=>{
              setSlots(previous=>previous.map(s=>s.position===slot.position?{...s,sealCode:seal.code,photoId:s.sealCode===seal.code?s.photoId:null}:s));setSealPicker(null);setProblem(null);
            }}/>) }
          {stock.hasNextPage && <Action secondary label={t('liveSeals.loadMore')} disabled={locked || stock.isFetching} onPress={()=>void stock.fetchNextPage()}/>}
        </>}
        <Label>{t('liveSeals.photo')}</Label>
        <Copy>{slot.photoId && allPhotos.some(p=>p.id===slot.photoId)?t('liveSeals.photoAttached'):t('liveSeals.noPhoto')}</Copy>
        {!slot.sealCode && <Copy>{t('liveSeals.sealBeforePhoto')}</Copy>}
        <EvidencePanel draftId={fitting.draftId} kinds={['SEAL_FITTING_PHOTO']} compact disabled={save.isPending || uncertain || !slot.sealCode}
          uploadLabel={t('liveSeals.uploadPhoto')} onUploaded={photo=>{
            setNewPhotos(previous=>[...previous.filter(p=>p.id!==photo.id),photo]);
            setSlots(previous=>previous.map(s=>s.position===slot.position?{...s,photoId:photo.id}:s));setProblem(null);
          }} onBusyChange={busy=>setUploading(previous=>(previous[slot.position]??false)===busy?previous:{...previous,[slot.position]:busy})}/>
        <Action secondary label={t('liveSeals.choosePhoto')} disabled={locked || !slot.sealCode} onPress={()=>setPhotoPicker(photoPicker===slot.position?null:slot.position)}/>
        {photoPicker===slot.position && <>
          {allPhotos.length===0 && <Notice>{t('liveSeals.noPhotos')}</Notice>}
          {allPhotos.map((photo,index)=><Action key={photo.id} secondary={slot.photoId!==photo.id} disabled={locked || slots.some(s=>s.position!==slot.position && s.photoId===photo.id)}
            label={t('liveSeals.photoChoice',{number:index+1})} onPress={()=>{setSlots(previous=>previous.map(s=>s.position===slot.position?{...s,photoId:photo.id}:s));setPhotoPicker(null);}}/>)}
          <Action secondary label={t('liveSeals.removePhoto')} disabled={locked} onPress={()=>{setSlots(previous=>previous.map(s=>s.position===slot.position?{...s,photoId:null}:s));setPhotoPicker(null);}}/>
        </>}
        <Action secondary label={t('liveSeals.clear')} disabled={locked} onPress={()=>setSlots(previous=>previous.map(s=>s.position===slot.position?{...s,sealCode:'',photoId:null}:s))}/>
      </Card>;})}
      <Action secondary label={t('liveSeals.refreshStock')} disabled={locked || stock.isFetching} onPress={()=>void stock.refetch()}/>
    </>}
    {problem && <Notice tone="danger">{t('liveSeals.'+problem.key,{number:problem.position})}</Notice>}
    {save.isError && <SealError error={save.error}/>}
    {uncertain && <Notice tone="warning">{t('liveSeals.uncertain')}</Notice>}
    <Action label={t(save.isPending?'liveSeals.saving':uncertain?'liveSeals.retry':'liveSeals.save')} icon="save-outline" disabled={save.isPending || Object.values(uploading).some(Boolean) || chosen===null} onPress={submit}/>
  </>;
}
