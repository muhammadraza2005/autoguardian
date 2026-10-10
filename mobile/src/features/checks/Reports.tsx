import {useEffect,useRef,useState} from 'react';
import {AppState,Platform,TextInput,View} from 'react-native';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';
import {randomUUID} from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import {z} from 'zod';
import {useSession} from '@/features/auth/SessionProvider';
import {AppHeader,StitchPage,Heading,Copy,Card,Label,Action,Notice,stitchStyles as u} from '@/components/ui/Stitch';
import {pickNativeEvidence} from '@/features/enrollment/nativeEvidence';
import {EvidencePreview} from '@/features/enrollment/EvidencePreview';
import {WorkflowError,useScreenFocused} from './Screens';
import {reportItem} from './contracts';

export default function ReportsScreen(){
  const {t}=useTranslation(),router=useRouter(),{profile,request}=useSession(),params=useLocalSearchParams<{vehicleId?:string}>(),focused=useScreenFocused();
  const [review,setReview]=useState(false),[vehicle,setVehicle]=useState(params.vehicleId??''),[kind,setKind]=useState<'incident'|'missing'|'recovered'>('incident');
  const [occurred,setOccurred]=useState(()=>new Date().toISOString()),[description,setDescription]=useState(''),[reason,setReason]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[saved,setSaved]=useState(false),[preview,setPreview]=useState<{mimeType:string;dataBase64:string}|null>(null);
  const [hasPending,setHasPending]=useState(false);
  const lock=useRef(false),key=useRef<string|null>(null),pending=useRef<{report:string;key:string;body:{kind:string;dataBase64:string}}|null>(null);
  const reviewer=profile?.roles.some(r=>r.code==='TENANT_ADMIN'&&r.organizationId===null);
  const query=useQuery({queryKey:['vehicle-reports',profile?.tenantId,profile?.id,review],queryFn:async({signal})=>
    z.object({items:z.array(reportItem)}).parse(await request(review?'/v1/vehicle-report-reviews':'/v1/vehicle-reports',{signal})),
    enabled:focused,retry:false,gcTime:0,refetchOnMount:'always'});
  useEffect(()=>{const subscription=AppState.addEventListener('change',state=>{if(state!=='active'){setPreview(null);pending.current=null;setHasPending(false);}});
    return()=>{subscription.remove();pending.current=null;};},[]);
  function edit(callback:()=>void){callback();key.current=null;setSaved(false);}
  async function submit(){
    if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);key.current??=randomUUID();
    try{await request('/v1/vehicle-reports',{method:'POST',idempotencyKey:key.current,body:{vehicleId:vehicle,kind,occurredAt:occurred,description}});setSaved(true);await query.refetch();}
    catch(e){setError(e);}finally{lock.current=false;setBusy(false);}
  }
  async function sendEvidence(){
    const attempt=pending.current;if(!attempt)return;
    await request('/v1/vehicle-reports/'+attempt.report+'/evidence',{method:'POST',idempotencyKey:attempt.key,body:attempt.body});
    pending.current=null;setHasPending(false);await query.refetch();
  }
  async function upload(report:string,retry=false){
    if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);
    try{
      if(!retry){
        let dataUrl:string|undefined;
        if(Platform.OS!=='web'){dataUrl=(await pickNativeEvidence('REGISTRATION_DOCUMENT',false))?.dataUrl;}
        else{
          const result=await DocumentPicker.getDocumentAsync({type:['image/jpeg','image/png','application/pdf'],multiple:false,copyToCacheDirectory:false,base64:false});
          if(result.canceled)return;const file=result.assets[0]?.file;if(!file||file.size>2097152||file.size<1)throw new Error();
          dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error());reader.readAsDataURL(file);});
        }
        if(!dataUrl)return;
        pending.current={report,key:randomUUID(),body:{kind:dataUrl.startsWith('data:application/pdf;')?'REGISTRATION_DOCUMENT':'VEHICLE_PHOTO',dataBase64:dataUrl.split(',')[1]}};
        setHasPending(true);
      }
      await sendEvidence();
    }catch(e){setError(e);}finally{lock.current=false;setBusy(false);}
  }
  async function readEvidence(id:string){
    if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);setPreview(null);
    try{const file=z.object({id:z.uuid(),mimeType:z.enum(['image/jpeg','application/pdf']),dataBase64:z.string().max(2796204)}).parse(
      await request((review?'/v1/vehicle-report-reviews':'/v1/vehicle-reports')+'/evidence/'+id));
      if(AppState.currentState==='active')setPreview(file);
    }catch(e){setError(e);}finally{lock.current=false;setBusy(false);}
  }
  const reviewKeys=useRef(new Map<string,string>());
  async function decide(id:string,status:'accepted'|'rejected'){
    if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);
    const fingerprint=JSON.stringify([id,status,reason]);if(!reviewKeys.current.has(fingerprint))reviewKeys.current.set(fingerprint,randomUUID());
    try{await request('/v1/vehicle-report-reviews/'+id,{method:'POST',idempotencyKey:reviewKeys.current.get(fingerprint),body:{status,reason}});await query.refetch();}
    catch(e){setError(e);}finally{lock.current=false;setBusy(false);}
  }
  return <View style={{flex:1}}><AppHeader/><StitchPage><Heading>{t('m2.reports')}</Heading><Notice>{t('m2.development')}</Notice>
    {!review&&<Card><Label>{t('m2.vehicleId')}</Label><TextInput style={u.input} accessibilityLabel={t('m2.vehicleId')} value={vehicle} onChangeText={v=>edit(()=>setVehicle(v))} editable={!busy} autoCapitalize="none"/>
      {(['incident','missing','recovered'] as const).map(k=><Action key={k} secondary label={t('m2.'+k)} disabled={busy} onPress={()=>edit(()=>setKind(k))}/>)}
      <Label>{t('m2.'+kind)}</Label><Label>{t('m2.occurred')}</Label><TextInput style={u.input} accessibilityLabel={t('m2.occurred')} value={occurred} onChangeText={v=>edit(()=>setOccurred(v))} editable={!busy}/>
      <Label>{t('m2.description')}</Label><TextInput multiline style={u.input} accessibilityLabel={t('m2.description')} maxLength={2000} value={description} onChangeText={v=>edit(()=>setDescription(v))} editable={!busy}/>
      <Action label={t('m2.report')} disabled={busy||!z.uuid().safeParse(vehicle).success||description.trim().length<3||!Number.isFinite(Date.parse(occurred))} onPress={()=>void submit()}/>
    </Card>}
    {reviewer&&<Action secondary label={t(review?'m2.reports':'m2.reportReview')} disabled={busy} onPress={()=>{setPreview(null);setReview(!review);}}/>}
    {review&&<><Label>{t('m2.reason')}</Label><TextInput accessibilityLabel={t('m2.reason')} value={reason} onChangeText={setReason} style={u.input} maxLength={500}/></>}
    {saved&&<Notice>{t('m2.reportSaved')}</Notice>}{error!==undefined&&<WorkflowError error={error}/>}{query.isError&&<WorkflowError error={query.error}/>}
    <Copy>{t('m2.evidenceHelp')}</Copy>
    {!query.isError&&query.data?.items.map(r=><Card key={r.id}><Label>{t('m2.'+r.kind)}</Label><Copy>{r.description}</Copy><Copy>{t('m2.'+r.status)}</Copy>
      <Copy selectable>{r.vehicleId}</Copy>{r.history.map((e,i)=><Copy key={i}>{new Date(e.createdAt).toLocaleString()} · {t('m2.events.'+e.action)} {e.reason??''}</Copy>)}
      {r.evidence.map(e=><Action secondary key={e.id} label={t('m2.evidence')+' ('+Math.ceil(e.byteSize/1024)+' KB)'} disabled={busy} onPress={()=>void readEvidence(e.id)}/>)}
      {!review&&r.status==='submitted'&&<Action secondary label={t('m2.upload')} disabled={busy||hasPending} onPress={()=>void upload(r.id)}/>}
      {review&&r.status==='submitted'&&<><Action label={t('m2.accept')} disabled={busy||reason.trim().length<3} onPress={()=>void decide(r.id,'accepted')}/>
        <Action danger label={t('m2.reject')} disabled={busy||reason.trim().length<3} onPress={()=>void decide(r.id,'rejected')}/></>}
    </Card>)}
    {hasPending&&<Action label={t('m2.retryUpload')} disabled={busy} onPress={()=>{const attempt=pending.current;if(attempt)void upload(attempt.report,true);}}/>}
    {preview&&focused&&<EvidencePreview {...preview} onFailed={()=>{setPreview(null);setError(new Error());}}/>}
    <Action secondary label={t('ownedVehicles.refresh')} disabled={busy||query.isFetching} onPress={()=>void query.refetch()}/>
    <Action secondary label={t('devAuth.account')} onPress={()=>router.replace('/live-account')}/>
  </StitchPage></View>;
}
