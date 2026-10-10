import {useEffect,useRef,useState} from 'react';
import {AppState,View} from 'react-native';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {randomUUID} from 'expo-crypto';
import {useTranslation} from 'react-i18next';
import {useSession} from '@/features/auth/SessionProvider';
import {ApiError} from '@/services/api/client';
import {Action,AppHeader,Card,Copy,Heading,Notice,StitchPage} from '@/components/ui/Stitch';
import {EvidencePreview} from '@/features/enrollment/EvidencePreview';
import {changeReview,reviewQueue,reviewState,reviewReasons,type ReviewAttempt,type ReviewBody,type ReviewState} from './registrationReviews';
import {loadReview,persistReview,clearReview} from './reviewRecovery';

export default function RegistrationReviewsScreen(){
  const {t}=useTranslation();const {profile,request}=useSession();const [id,setId]=useState<string|null>(null),[offset,setOffset]=useState(0);
  const allowed=Boolean(profile?.roles.some(r=>r.code==='TENANT_ADMIN'&&r.organizationId===null));
  const queue=useQuery({queryKey:['authority-reviews',profile?.tenantId,profile?.id,offset],queryFn:({signal})=>reviewQueue(request,offset,signal),
    enabled:allowed&&!id,gcTime:0,retry:false,refetchOnWindowFocus:false});
  return <View style={{flex:1}}><AppHeader/><StitchPage><Heading>{t('registrationReview.title')}</Heading><Copy>{t('registrationReview.policy')}</Copy>
    {!allowed?<Notice tone="danger">{t('registrationReview.denied')}</Notice>:id?<Review key={id} id={id} back={()=>setId(null)}/>:
      <>{queue.isFetching&&<Copy>{t('registrationReview.loading')}</Copy>}{queue.isError&&<Notice tone="danger">{t('registrationReview.'+failureKey(queue.error))}</Notice>}
      {!queue.isFetching&&!queue.isError&&queue.data?.items.length===0&&<Copy>{t('registrationReview.empty')}</Copy>}
      {!queue.isFetching&&!queue.isError&&queue.data?.items.map(item=><Card key={item.id}><Heading>{item.chassisIdentifier}</Heading><Copy>{item.plate}</Copy>
        {item.mode==='DEVELOPMENT'&&<Notice>{t('registrationReview.sample')}</Notice>}<Action label={t('registrationReview.open')} onPress={()=>setId(item.id)}/></Card>)}
      <Action secondary disabled={queue.isFetching||offset===0} label={t('registrationReview.previous')} onPress={()=>setOffset(n=>Math.max(0,n-20))}/>
      <Action secondary disabled={queue.isFetching||queue.data?.items.length!==20} label={t('registrationReview.next')} onPress={()=>setOffset(n=>n+20)}/>
      <Action secondary disabled={queue.isFetching} label={t('registrationReview.refresh')} onPress={()=>void queue.refetch()}/></>}
  </StitchPage></View>;
}
function failureKey(error:unknown){return error instanceof ApiError?(error.status===503?'setup':error.status===409?'conflict':[401,403,404].includes(error.status)?'denied':'failed'):'failed';}
function Review({id,back}:{id:string;back:()=>void}){
  const {t}=useTranslation();const {profile,request}=useSession();const cache=useQueryClient();
  const queryKey=['authority-review',profile?.tenantId,profile?.id,id];
  const query=useQuery({queryKey,queryFn:({signal})=>reviewState(request,id,signal),gcTime:0,retry:false,refetchOnWindowFocus:false});
  const [busy,setBusy]=useState(false),[restoring,setRestoring]=useState(true),[uncertain,setUncertain]=useState(false),[storageFailed,setStorageFailed]=useState(false),[error,setError]=useState<unknown>(null);
  const [preview,setPreview]=useState<{id:string;mimeType:string;dataBase64:string;snapshot:number}|null>(null),[rendered,setRendered]=useState(false),[attested,setAttested]=useState(false);
  const [replacement,setReplacement]=useState<string|null>(null),[checked,setChecked]=useState(new Set<string>());
  const attempt=useRef<ReviewAttempt|null>(null),mounted=useRef(true),inFlight=useRef(false),abort=useRef<AbortController|null>(null);
  useEffect(()=>{mounted.current=true;void loadReview(id).then(value=>{if(mounted.current){attempt.current=value;setUncertain(Boolean(value));}})
    .catch(e=>{if(mounted.current){setError(e);setStorageFailed(true);}}).finally(()=>{if(mounted.current)setRestoring(false);});
    const sub=AppState.addEventListener('change',state=>{if(state!=='active'){abort.current?.abort();setPreview(null);setChecked(new Set());setAttested(false);}});
    return()=>{mounted.current=false;abort.current?.abort();sub.remove();};},[id]);
  const value=!query.isFetching&&!query.isError?query.data:undefined;
  const locked=busy||restoring||uncertain||storageFailed||query.isFetching||!value;
  function body(action:ReviewBody['action'],attachmentId:string|null=null,reason:ReviewBody['reason']=null,replacementId:string|null=null):ReviewBody{
    return {expectedDraftRevision:value!.draftRevision,expectedSnapshotRevision:value!.snapshotRevision,expectedReviewRevision:value!.reviewRevision,
      action,attachmentId,reason,replacementId,inspected:action!=='READ_REQUESTED'};
  }
  async function save(input?:ReviewBody){
    if(inFlight.current || (!attempt.current&&(!input||locked)))return;
    if(!attempt.current)attempt.current={key:randomUUID(),body:input!};
    const saved=attempt.current;inFlight.current=true;setBusy(true);setError(null);setPreview(null);setAttested(false);
    try{await persistReview(id,saved);if(!mounted.current)return;const result=await changeReview(request,id,saved);
      if(!mounted.current)return;await clearReview(id);attempt.current=null;setUncertain(false);cache.setQueryData(queryKey,result as ReviewState);
    }catch(e){if(!mounted.current)return;const definite=e instanceof ApiError&&[400,401,403,404,409,422].includes(e.status);
      if(definite){await clearReview(id).catch(()=>{});attempt.current=null;setUncertain(false);setChecked(new Set());void query.refetch();}else setUncertain(true);setError(e);
    }finally{inFlight.current=false;if(mounted.current)setBusy(false);}
  }
  async function inspect(attachmentId:string){
    if(locked||inFlight.current||!value)return;inFlight.current=true;setBusy(true);setError(null);setPreview(null);setRendered(false);abort.current=new AbortController();
    try{const result=await changeReview(request,id,{key:randomUUID(),body:body('READ_REQUESTED',attachmentId)},abort.current.signal);
      if(mounted.current&&AppState.currentState==='active'&&'dataBase64'in result)setPreview({...result,snapshot:value.snapshotRevision});
    }catch(e){if(mounted.current)setError(e);}finally{inFlight.current=false;if(mounted.current)setBusy(false);}
  }
  return <><Action secondary disabled={busy||uncertain||restoring||storageFailed} label={t('registrationReview.back')} onPress={back}/>
    {query.isFetching&&<Copy>{t('registrationReview.loading')}</Copy>}
    {Boolean(error||query.error)&&<Notice tone="danger">{t('registrationReview.'+failureKey(error||query.error))}</Notice>}
    {uncertain&&<><Notice tone="warning">{t('registrationReview.uncertain')}</Notice><Action disabled={busy} label={t('registrationReview.retry')} onPress={()=>void save()}/>
      <Action secondary disabled={busy} label={t('registrationReview.discard')} onPress={()=>{void clearReview(id).then(()=>{attempt.current=null;setUncertain(false);setChecked(new Set());void query.refetch();}).catch(setError);}}/></>}
    {preview&&value?.snapshotRevision===preview.snapshot&&<Card><EvidencePreview key={preview.snapshot+':'+preview.id} {...preview} onInspected={()=>setRendered(true)} onFailed={()=>{setPreview(null);setRendered(false);setError(new Error('VIEW_FAILED'));}}/>
      <Action secondary disabled={!rendered||busy} label={t('registrationReview.inspected')} onPress={()=>{setChecked(old=>new Set([...old,preview.snapshot+':'+preview.id]));setPreview(null);}}/>
      <Action secondary label={t('registrationReview.close')} onPress={()=>setPreview(null)}/></Card>}
    {value&&<><Heading>{value.vehicle.chassisIdentifier}</Heading><Copy>{[value.vehicle.plate,value.vehicle.category,value.vehicle.make,value.vehicle.model,value.vehicle.manufactureYear,value.vehicle.color].filter(Boolean).join(' · ')}</Copy>
      {value.mode==='DEVELOPMENT'&&<Notice>{t('registrationReview.sample')}</Notice>}
      {value.frozen&&<Notice>{t('registrationReview.frozen')}</Notice>}
      <Notice tone={value.evidenceComplete?'neutral':'warning'}>{t('registrationReview.'+(value.evidenceComplete?'evidenceReady':'evidenceMissing'))}</Notice>
      <Notice tone={value.sealsConfirmed?'neutral':'warning'}>{t('registrationReview.'+(value.sealsConfirmed?'sealReady':'sealMissing'))}</Notice>
      {value.sealPackage&&<Copy>{t('liveSeals.packages.'+value.sealPackage)}</Copy>}
      {value.sealLocations.map(location=><Copy key={location.position}>{location.position+' · '+location.description}</Copy>)}
      {value.productionApproved&&<Notice>{t('registrationReview.approved')}</Notice>}
      {value.items.map(item=><Card key={item.id}><Heading>{t('liveEvidence.kinds.'+item.kind)}</Heading><Copy selectable>{item.id}</Copy>
        <Copy>{t('registrationReview.decisions.'+item.decision)}</Copy>{item.reason&&<Notice tone="warning">{t('registrationReview.reasons.'+item.reason)}</Notice>}
        {item.replacementId&&<Copy selectable>{item.replacementId}</Copy>}
        <Action secondary disabled={locked||item.status!=='STAGED'} label={t('registrationReview.inspect')} onPress={()=>void inspect(item.id)}/>
        {item.decision!=='SUPERSEDED'&&<><Action disabled={locked||value.frozen||!checked.has(value.snapshotRevision+':'+item.id)} label={t('registrationReview.accept')}
          onPress={()=>void save(body('ACCEPTED',item.id))}/>
        {reviewReasons.map(reason=><Action key={reason} secondary disabled={locked||value.frozen||!checked.has(value.snapshotRevision+':'+item.id)}
          label={t('registrationReview.correct')+' — '+t('registrationReview.reasons.'+reason)} onPress={()=>void save(body('NEEDS_CORRECTION',item.id,reason))}/>)}
        <Action secondary disabled={locked||value.frozen} label={t('registrationReview.replace')} onPress={()=>setReplacement(item.id)}/></>}
        {replacement&&replacement!==item.id&&value.items.find(i=>i.id===replacement)?.kind===item.kind&&item.status==='STAGED'&&item.decision!=='SUPERSEDED'&&
          <Action disabled={locked||value.frozen} label={t('registrationReview.replaceWith')} onPress={()=>{void save(body('SUPERSEDED',replacement,null,item.id));setReplacement(null);}}/>}
      </Card>)}
      {replacement&&<Action secondary label={t('registrationReview.cancelReplace')} onPress={()=>setReplacement(null)}/>}
      <Action secondary disabled={locked||!value.canApprove} label={(attested?'✓ ':'')+t('registrationReview.attest')} onPress={()=>setAttested(v=>!v)}/>
      <Action disabled={locked||!value.canApprove||!attested} label={t('registrationReview.approve')} onPress={()=>void save(body('APPROVED'))}/>
      <Heading>{t('registrationReview.history')}</Heading>{value.history.map(event=><Copy key={event.id} selectable>{event.createdAt+' · '+t('registrationReview.decisions.'+event.action)+' · '+(event.attachmentId??'')+(event.reason?' · '+t('registrationReview.reasons.'+event.reason):'')}</Copy>)}
    </>}
    <Action secondary disabled={busy||uncertain||restoring||storageFailed} label={t('registrationReview.refresh')} onPress={()=>{setPreview(null);setChecked(new Set());setAttested(false);void query.refetch();}}/>
  </>;
}
