import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { ZodError } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/features/auth/SessionProvider';
import { profileScope } from '@/features/auth/authEvents';
import { runtime } from '@/config/runtime';
import { ApiError } from '@/services/api/client';
import { workingCopies } from './workingCopies';
import { createOfflineSync } from './offlineSync';
import { offlineSyncEditors } from './offlineSyncEditors';
import { saveDraft } from './drafts';
import { saveSealFitting } from './seals';
import { createEnrollmentJournalSync } from './offlineJournals';

// Mount once within SessionProvider. Native recovery remains locked until that
// provider has authenticated AND fetched current roles online. There is no
// cached-profile offline login or client-created authorization policy.
export function OfflineSyncBridge(){
  const session=useSession(),cache=useQueryClient();
  const latest=useRef(session);
  const updateRef=useRef<()=>void>(()=>{});
  useEffect(()=>{latest.current=session;updateRef.current();},[session]);
  useEffect(()=>{
    if(Platform.OS==='web' || runtime.isDemo)return;
    let connected=false,active=AppState.currentState==='active',running=false;
    const reconcile=async()=>{
      await Promise.all(['enrollment-drafts','enrollment-draft','enrollment-readiness','seal-fitting','seal-stock',
        'enrollment-evidence','enrollment-owner','enrollment-submission','evidence-reviews','owned-vehicles','offline-sync-journals']
        .map(key=>cache.invalidateQueries({queryKey:[key]})));
    };
    const journals=createEnrollmentJournalSync((path,options)=>latest.current.request(path,options),reconcile);
    const worker=createOfflineSync({store:workingCopies,
      classify:error=>error instanceof ZodError?'INVALID':error instanceof ApiError
        ? error.status===409?'CONFLICT':[401,403].includes(error.status)?'DENIED'
          :[400,404,422].includes(error.status)?'INVALID':'RETRY'
        :'RETRY',
      send:async(entry,signal)=>{
        const pending=entry.copy.pending;if(!pending)return;
        const request=(path:string,options:Parameters<typeof latest.current.request>[1])=>latest.current.request(path,{...options,signal});
        if(entry.copy.kind==='vehicle' && entry.copy.pending){
          await saveDraft(request,entry.copy.pending.body,entry.id==='new'?{key:pending.key}
            :{id:entry.id,revision:entry.copy.pending.revision});
        }else if(entry.copy.kind==='seals' && entry.copy.pending){
          await saveSealFitting(request,entry.id,pending.key,entry.copy.pending.body);
        }
      },
      completed:reconcile,
    });
    function update(){
      const current=latest.current,profile=current.profile;
      const agent=profile?.roles.some(role=>role.code==='ENROLLMENT_AGENT' && role.organizationId);
      const allowed=Boolean(agent && !current.loading && !current.error && connected && active && !offlineSyncEditors.active());
      worker.configure(profile?profileScope(profile):null,allowed);journals.configure(allowed,profile?profileScope(profile):null);
      if(!running){running=true;void worker.tick().then(()=>journals.tick()).catch(()=>{}).finally(()=>{running=false;});}
    }
    updateRef.current=update;
    const unsubscribeNetwork=NetInfo.addEventListener(state=>{connected=state.isConnected===true && state.isInternetReachable!==false;update();});
    const appState=AppState.addEventListener('change',state=>{active=state==='active';update();});
    const unsubscribeEditors=offlineSyncEditors.subscribe(update);
    const unsubscribeStore=workingCopies.subscribe(()=>{if(workingCopies.getStatus()!=='saving')update();});
    // A bounded foreground poll drives persisted backoff deadlines and notices
    // role/session changes; it is not a background execution guarantee.
    const interval=setInterval(update,5000);update();
    return ()=>{updateRef.current=()=>{};clearInterval(interval);worker.stop();journals.stop();unsubscribeNetwork();unsubscribeEditors();unsubscribeStore();appState.remove();};
  },[cache]);
  return null;
}
