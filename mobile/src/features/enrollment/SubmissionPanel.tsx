import {useEffect,useRef,useState} from 'react';
import {Platform} from 'react-native';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {randomUUID} from 'expo-crypto';
import {useTranslation} from 'react-i18next';
import {useSession} from '@/features/auth/SessionProvider';
import {ApiError} from '@/services/api/client';
import {Action,Card,Copy,Heading,Notice} from '@/components/ui/Stitch';
import {readSubmission,executeSubmission,type SubmissionAttempt} from './submission';
import {loadSubmissionRecovery,saveSubmissionRecovery,removeSubmissionRecovery} from './submissionRecovery';
export function SubmissionPanel({draftId,disabled=false,onBusyChange}:{draftId:string;disabled?:boolean;onBusyChange?:(busy:boolean)=>void}){
  const {t}=useTranslation(),{profile,request}=useSession(),cache=useQueryClient();
  const queryKey=['enrollment-submission',profile?.tenantId,profile?.id,draftId];
  const query=useQuery({queryKey,queryFn:({signal})=>readSubmission(request,draftId,signal),gcTime:0,retry:false,networkMode:'always',refetchOnWindowFocus:false});
  const [busy,setBusy]=useState(false),[restoring,setRestoring]=useState(Platform.OS!=='web'),[uncertain,setUncertain]=useState(false);
  const [corrupt,setCorrupt]=useState(false),[error,setError]=useState(false);
  const pending=useRef<SubmissionAttempt|null>(null),flight=useRef(false),mounted=useRef(true),callback=useRef(onBusyChange);
  useEffect(()=>{callback.current=onBusyChange;},[onBusyChange]);
  useEffect(()=>{callback.current?.(busy||restoring||uncertain||corrupt);},[busy,restoring,uncertain,corrupt]);
  useEffect(()=>{mounted.current=true;let active=true;
    void loadSubmissionRecovery(draftId).then(value=>{if(active){pending.current=value;setUncertain(Boolean(value));}})
      .catch(()=>{if(active){setCorrupt(true);setError(true);}}).finally(()=>{if(active)setRestoring(false);});
    return()=>{active=false;mounted.current=false;callback.current?.(false);};
  },[draftId]);
  const value=!query.isFetching&&!query.isError?query.data:undefined;
  const locked=disabled||busy||restoring||corrupt||query.isFetching;
  async function send(action?:'submit'|'finalize'){
    if(flight.current || locked)return;
    if(!pending.current){
      if(!action||!value||(action==='submit'?!value.canSubmit:!value.canFinalize))return;
      pending.current={key:randomUUID(),action,body:{expectedDraftRevision:value.draftRevision,expectedSnapshotRevision:value.snapshotRevision}};
    }
    const attempt=pending.current;flight.current=true;setBusy(true);setError(false);
    try{
      await saveSubmissionRecovery(draftId,attempt);
      if(!mounted.current)return;
      const result=await executeSubmission(request,draftId,attempt);if(!mounted.current)return;
      await removeSubmissionRecovery(draftId);if(!mounted.current)return;
      pending.current=null;setUncertain(false);cache.setQueryData(queryKey,result);
      if(result.status==='ACTIVE')void cache.invalidateQueries({queryKey:['owned-vehicles']});
    }catch(failure){if(!mounted.current)return;
      // A 409 may be a serializable-transaction retry or a changed prerequisite.
      // Keep the exact request until a refresh/explicit discard resolves it.
      const definite=failure instanceof ApiError && [400,401,403,404,422].includes(failure.status);
      if(definite){pending.current=null;await removeSubmissionRecovery(draftId).catch(()=>{});void query.refetch();}
      setUncertain(!definite);setError(true);
    }finally{flight.current=false;if(mounted.current)setBusy(false);}
  }
  async function refresh(){if(flight.current)return;setBusy(true);try{await removeSubmissionRecovery(draftId);
    pending.current=null;setCorrupt(false);setUncertain(false);setError(false);await query.refetch();}
    catch{setError(true);}finally{if(mounted.current)setBusy(false);}}
  return <Card><Heading>{t('registrationSubmission.title')}</Heading>
    {(query.isPending||query.isFetching||restoring)&&<Copy>{t('registrationSubmission.loading')}</Copy>}
    {(query.isError||error)&&<Notice tone="danger">{t('registrationSubmission.failed')}</Notice>}
    {value&&<><Copy>{t('registrationSubmission.states.'+value.status)}</Copy>
      {value.mode==='DEVELOPMENT'&&<Notice tone="warning">{t('registrationSubmission.sample')}</Notice>}
      {!value.ownerReady&&<Notice>{t('registrationSubmission.ownerPending')}</Notice>}
      {value.status!=='ACTIVE'&&value.checks.map(check=><Copy key={check.code}>
        {t(check.code==='SEALS'?'registrationSubmission.seals':'liveReadiness.checks.'+check.code+'.title')}: {t('registrationSubmission.checks.'+check.status)}</Copy>)}
      {value.status==='DRAFT'&&<Action label={t('registrationSubmission.submit')} disabled={locked||uncertain||!value.canSubmit} onPress={()=>void send('submit')}/>}
      {value.status==='SUBMITTED'&&<Action label={t('registrationSubmission.finalize')} disabled={locked||uncertain||!value.canFinalize} onPress={()=>void send('finalize')}/>}
      {value.status==='ACTIVE'&&<Notice>{t('registrationSubmission.active')}</Notice>}
    </>}
    {uncertain&&<><Notice tone="warning">{t('registrationSubmission.uncertain')}</Notice>
      <Action label={t('registrationSubmission.retry')} disabled={locked} onPress={()=>void send()}/></>}
    <Action secondary label={t(uncertain||corrupt?'registrationSubmission.discard':'liveReadiness.refresh')}
      disabled={disabled||busy||restoring||query.isFetching} onPress={()=>void refresh()}/>
  </Card>;
}
