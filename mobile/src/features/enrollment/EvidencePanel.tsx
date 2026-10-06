import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { randomUUID } from 'expo-crypto';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/SessionProvider';
import { ApiError } from '@/services/api/client';
import { Action, Card, Copy, Heading, Notice } from '@/components/ui/Stitch';
import { listEvidence, readEvidence, sampleFilePayload, uploadEvidence, type EvidenceKind, type evidenceMetadata } from './evidence';
import type {z} from 'zod';

// Browser sample files stay in memory. Native private file capture remains gated
// until local metadata AND attachment encryption have been verified.
export function EvidencePanel({draftId,kinds=['OWNER_ID','REGISTRATION_DOCUMENT','VEHICLE_PHOTO','SEAL_FITTING_PHOTO'],compact=false,disabled=false,
  uploadLabel,onUploaded,onBusyChange}:{draftId:string;kinds?:readonly EvidenceKind[];compact?:boolean;disabled?:boolean;uploadLabel?:string;
    onUploaded?:(file:z.infer<typeof evidenceMetadata>)=>void;onBusyChange?:(busy:boolean)=>void}) {
  const {t}=useTranslation();const {request,profile}=useSession();
  const query=useQuery({queryKey:['enrollment-evidence',profile?.tenantId,profile?.id,draftId],
    queryFn:({signal})=>listEvidence(request,draftId,signal),gcTime:0,retry:false,networkMode:'always',refetchOnWindowFocus:false});
  const [busy,setBusy]=useState(false);const [error,setError]=useState(false);const [success,setSuccess]=useState(false);
  const [uncertain,setUncertain]=useState(false);const mounted=useRef(true);const abort=useRef<AbortController|null>(null);
  const pending=useRef<{key:string;body:ReturnType<typeof sampleFilePayload>}|null>(null);
  const callbacks=useRef({onUploaded,onBusyChange});
  useEffect(()=>{callbacks.current={onUploaded,onBusyChange};},[onUploaded,onBusyChange]);
  useEffect(()=>{callbacks.current.onBusyChange?.(busy || uncertain);},[busy,uncertain]);
  useEffect(()=>()=>{callbacks.current.onBusyChange?.(false);},[]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;abort.current?.abort();pending.current=null;};},[]);
  async function send() {
    if(!pending.current)return;
    const attempt=pending.current;abort.current=new AbortController();
    try {
      const file=await uploadEvidence(request,draftId,attempt.key,attempt.body,abort.current.signal);
      if(!mounted.current)return;
      pending.current=null;setUncertain(false);setSuccess(true);callbacks.current.onUploaded?.(file);void query.refetch();
    } catch(e) {
      if(!mounted.current)return;
      // Retry only the identical payload/key after an ambiguous server/network outcome.
      const definite=e instanceof ApiError && [400,401,403,404,409,413,422].includes(e.status);
      if(definite)pending.current=null;
      setUncertain(!definite);setError(true);
    }
  }
  async function pick(kind:EvidenceKind) {
    if(disabled || busy || uncertain || Platform.OS!=='web')return;
    setBusy(true);setError(false);setSuccess(false);
    try {
      const result=await DocumentPicker.getDocumentAsync({type:['VEHICLE_PHOTO','SEAL_FITTING_PHOTO'].includes(kind)?['image/jpeg','image/png']:['application/pdf','image/jpeg','image/png'],
        multiple:false,base64:false,copyToCacheDirectory:false});
      if(result.canceled || !mounted.current)return;
      const file=result.assets[0]?.file;
      if(!file || file.size<1 || file.size>2097152)throw new Error('Invalid sample file.');
      const dataUrl=await new Promise<string>((resolve,reject)=>{
        const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('File unavailable.'));
        reader.readAsDataURL(file);
      });
      if(!mounted.current)return;
      pending.current={key:randomUUID(),body:sampleFilePayload(kind,dataUrl,file.size)};
      await send();
    } catch {if(mounted.current)setError(true);} finally {if(mounted.current)setBusy(false);}
  }
  async function retry() {if(busy)return;setBusy(true);setError(false);try{await send();}finally{if(mounted.current)setBusy(false);}}
  async function download(id:string) {
    if(busy || Platform.OS!=='web')return;
    setBusy(true);setError(false);setSuccess(false);abort.current=new AbortController();
    try {
      const file=await readEvidence(request,draftId,id,abort.current.signal);if(!mounted.current)return;
      const text=atob(file.dataBase64);const bytes=Uint8Array.from(text,c=>c.charCodeAt(0));
      const url=URL.createObjectURL(new Blob([bytes],{type:file.mimeType}));
      const link=document.createElement('a');link.href=url;link.download='sample-evidence.'+(file.mimeType==='application/pdf'?'pdf':file.mimeType==='image/png'?'png':'jpg');
      link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch {if(mounted.current)setError(true);} finally {if(mounted.current)setBusy(false);}
  }
  const enabled=Platform.OS==='web' && !query.isError && query.data?.uploadsEnabled;
  const content=<>
    {!compact && <><Heading>{t('liveEvidence.title')}</Heading><Notice tone="warning">{t('liveEvidence.samples')}</Notice></>}
    {Platform.OS!=='web' && <Notice>{t('liveEvidence.nativePending')}</Notice>}
    {query.isPending && <Copy>{t('liveEvidence.loading')}</Copy>}
    {query.isError && <Notice tone="danger">{t('liveEvidence.failed')}</Notice>}
    {query.data && !query.data.uploadsEnabled && <Notice>{t('liveEvidence.setupPending')}</Notice>}
    {kinds.map(kind=><Action key={kind} icon="cloud-upload-outline"
      label={uploadLabel??t('liveEvidence.add.'+kind)} disabled={disabled || busy || uncertain || !enabled || (query.data?.items.length??0)>=10} onPress={()=>void pick(kind)} />)}
    {error && <Notice tone="danger">{t('liveEvidence.failed')}</Notice>}
    {success && <Notice>{t('liveEvidence.saved')}</Notice>}
    {busy && <Copy>{t('liveEvidence.working')}</Copy>}
    {uncertain && <><Notice tone="warning">{t('liveEvidence.uncertain')}</Notice><Action label={t('liveEvidence.retry')} disabled={busy} onPress={()=>void retry()} /></>}
    {!compact && query.data?.items.length===0 && <Copy>{t('liveEvidence.empty')}</Copy>}
    {!compact && query.data?.items.filter(item=>kinds.includes(item.kind)).map(item=><Card key={item.id}>
      <Copy>{t('liveEvidence.kinds.'+item.kind)}</Copy>
      <Copy>{t(item.status==='STAGED'?'liveEvidence.staged':'liveEvidence.pending')}</Copy>
      {item.status==='STAGED' && <Action secondary label={t('liveEvidence.download')} disabled={busy || uncertain || !enabled} onPress={()=>void download(item.id)} />}
    </Card>)}
    {(!compact || query.isError) && <Action secondary label={t('liveEvidence.refresh')} disabled={disabled || busy || query.isFetching} onPress={()=>void query.refetch()} />}
  </>;
  return compact?content:<Card>{content}</Card>;
}
