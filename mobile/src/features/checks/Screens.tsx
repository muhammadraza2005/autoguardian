import {useCallback,useEffect,useRef,useState} from 'react';
import {AppState,TextInput,View} from 'react-native';
import {useFocusEffect,useLocalSearchParams,useRouter} from 'expo-router';
import {CameraView,useCameraPermissions} from 'expo-camera';
import {randomUUID} from 'expo-crypto';
import {useInfiniteQuery,useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';
import {useSession} from '@/features/auth/SessionProvider';
import {ApiError} from '@/services/api/client';
import {AppHeader,StitchPage,Heading,Copy,Card,Label,Action,Notice,stitchStyles as u} from '@/components/ui/Stitch';
import {checkResult,checkView,inboxItem,readCheck,safeVehicle} from './contracts';
import {z} from 'zod';
import {PaymentPanel} from '@/features/billing/PaymentPanel';
import {quoteSchema} from '@/features/billing/contracts';
import {PinEntry,useOwnerPinStatus,useTransientPin} from '@/features/ownerPin/PinEntry';
import {pinInput,requestPinProof} from '@/features/ownerPin/contracts';

export function useScreenFocused(){
  const [focused,setFocused]=useState(false);
  const [active,setActive]=useState(AppState.currentState==='active');
  useEffect(()=>{const subscription=AppState.addEventListener('change',state=>setActive(state==='active'));return()=>subscription.remove();},[]);
  useFocusEffect(useCallback(()=>{setFocused(true);return()=>setFocused(false);},[]));
  return focused&&active;
}
function useClock(){const [now,setNow]=useState(()=>Date.now());useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);return now;}

export function WorkflowError({error}:{error:unknown}){
  const {t}=useTranslation();
  const code=error instanceof ApiError?error.code:undefined,status=error instanceof ApiError?error.status:undefined;
  if(code?.startsWith('PIN_')||code==='OWNER_PIN_ACCESS_REQUIRED')return <Notice tone="danger">{t('ownerPin.error')}</Notice>;
  const key=code==='CHECKS_NOT_CONFIGURED'?'setup':code==='CHECK_AMBIGUOUS_IDENTIFIER'?'ambiguous':status===429?'rateLimit':status===403?'denied':status===404?'unknown':status===409?'changed':'error';
  return <Notice tone="danger">{t('m2.'+key)}</Notice>;
}
function Page({children}:{children:React.ReactNode}){return <View style={{flex:1}}><AppHeader/><StitchPage>{children}</StitchPage></View>;}
function Safety(){const {t}=useTranslation();return <Notice tone="warning">{t('m2.safety')}</Notice>;}
function Summary({vehicle}:{vehicle:z.infer<typeof safeVehicle>}){
  const {t}=useTranslation();return <Card><Heading>{vehicle.plate??vehicle.chassisIdentifier}</Heading>
    <Copy>{[vehicle.make,vehicle.model,vehicle.manufactureYear,vehicle.color].filter(v=>v!==null).join(' ')}</Copy>
    <Label>{t('ownedVehicles.saleStatus')}</Label><Copy>{t('ownedVehicles.sales.'+vehicle.saleStatus)}</Copy>
    <Label>{t('ownedVehicles.recordStatus')}</Label><Copy>{t('ownedVehicles.records.'+vehicle.recordStatus)}</Copy></Card>;
}
export function CheckInputScreen(){
  const {t}=useTranslation(),router=useRouter(),{request}=useSession();
  const params=useLocalSearchParams<{billingKey?:string}>(),savedKey=z.uuid().safeParse(params.billingKey);
  const [paymentKey,setPaymentKey]=useState<string|null>(null);
  const [method,setMethod]=useState<'plate'|'chassis'|'seal'|'qr'>('plate'),[value,setValue]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
  const [scan,setScan]=useState(false),[permission,requestPermission]=useCameraPermissions(),focused=useScreenFocused();
  const key=useRef<string|null>(savedKey.success?savedKey.data:null),lock=useRef(false);
  function change(v:string){setValue(v);if(!paymentKey&&!savedKey.success)key.current=null;setError(undefined);}
  async function submit(){
    if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);key.current??=randomUUID();
    try{
      const quote=await request('/v1/billing/check-quote?key='+key.current).then(quoteSchema.parse).catch(e=>{
        if(e instanceof ApiError&&e.status===404)return null;throw e;
      });
      if(quote?.configured&&!quote.allowed){setPaymentKey(key.current);return;}
      const result=checkResult.parse(await request('/v1/vehicle-checks',{method:'POST',body:{method,value:value.trim()},idempotencyKey:key.current}));
      router.push({pathname:'/live-checks/[id]',params:{id:result.id}});
    }catch(e){setError(e);}finally{lock.current=false;setBusy(false);}
  }
  return <Page><Heading>{t('navigation.check')}</Heading><Notice>{t('m2.development')}</Notice>
    <Card>{(['plate','chassis','seal','qr'] as const).map(m=><Action key={m} secondary label={t('m2.'+m)} disabled={busy} onPress={()=>{setMethod(m);change('');setScan(false);}}/>)}
      <Label>{t('m2.'+method)}</Label><TextInput accessibilityLabel={t('m2.'+method)} style={u.input} value={value} onChangeText={change}
        autoCapitalize={method==='qr'?'none':'characters'} autoCorrect={false} maxLength={method==='qr'?512:160} editable={!busy}/>
      {method==='qr'&&<Action secondary label={t('m2.scan')} disabled={busy} onPress={()=>{setScan(true);if(!permission?.granted)void requestPermission();}}/>}
      {scan&&focused&&permission?.granted&&<CameraView style={{height:240}} barcodeScannerSettings={{barcodeTypes:['qr']}}
        onBarcodeScanned={({data})=>{setMethod('qr');change(data);setScan(false);}}/>}
      {scan&&!permission?.granted&&<Notice>{t('m2.cameraDenied')}</Notice>}
      <Action label={t(busy?'devAuth.working':'m2.create')} disabled={busy||!value.trim()} onPress={()=>void submit()}/>
    </Card>{paymentKey&&<PaymentPanel key={paymentKey} purpose="CHECK" targetId={paymentKey}/>}{error!==undefined&&<WorkflowError error={error}/>}<Safety/>
    <Action secondary label={t('m2.checkHistory')} onPress={()=>router.push('/live-checks/history')}/>
    <Action secondary label={t('devAuth.account')} onPress={()=>router.replace('/live-account')}/>
  </Page>;
}
export function CheckResultScreen(){
  const {t}=useTranslation(),router=useRouter(),{request,profile}=useSession(),params=useLocalSearchParams<{id?:string}>();
  const parsed=z.uuid().safeParse(params.id),id=parsed.success?parsed.data:undefined,focused=useScreenFocused();
  const [active,setActive]=useState(AppState.currentState==='active'),now=useClock();
  useEffect(()=>{const subscription=AppState.addEventListener('change',state=>setActive(state==='active'));
    return()=>{subscription.remove();};},[]);
  const query=useQuery({queryKey:['vehicle-check',profile?.tenantId,profile?.id,id],queryFn:({signal})=>readCheck(request,id!,signal),
    enabled:!!id&&focused&&active,retry:false,gcTime:0,staleTime:0,refetchOnMount:'always',refetchInterval:5000,refetchIntervalInBackground:false});
  const result=!query.isError&&!query.isFetching&&active&&focused?query.data:undefined,view=result?checkView(result,now):undefined;
  return <Page><Heading>{t('m2.result')}</Heading>{query.isFetching&&<Copy>{t('devAuth.loading')}</Copy>}
    {query.isError&&<WorkflowError error={query.error}/>}<Notice>{t('m2.development')}</Notice>
    {result&&view&&<><Card><Heading>{t('m2.outcomes.'+view.outcome)}</Heading><Copy selectable>{result.id}</Copy>
      {result.outcome==='pending'&&<Copy>{t('m2.remaining',{seconds:view.remaining})}</Copy>}
      <Label>{t('m2.deadline')}</Label><Copy>{new Date(result.responseDeadlineAt).toLocaleString()}</Copy>
      {result.resultExpiresAt&&<><Label>{t('m2.expires')}</Label><Copy>{new Date(result.resultExpiresAt).toLocaleString()}</Copy></>}
    </Card>{result.vehicle&&!view.expired&&<Summary vehicle={result.vehicle}/>}</>}
    <Safety/><Action secondary label={t('ownedVehicles.refresh')} disabled={query.isFetching||!id} onPress={()=>void query.refetch()}/>
    <Action label={t('m2.fresh')} onPress={()=>router.replace('/live-checks')}/>
  </Page>;
}
export function CheckHistoryScreen({owner=false}:{owner?:boolean}){
  const {t}=useTranslation(),router=useRouter(),{request,profile}=useSession(),focused=useScreenFocused();
  const now=useClock();
  const pinStatus=useOwnerPinStatus(owner&&focused),pin=useTransientPin();
  const [selected,setSelected]=useState<{id:string;decision:'approved'|'refused'}|null>(null);
  const [error,setError]=useState<unknown>(),[busy,setBusy]=useState(false),[saved,setSaved]=useState<string|null>(null),lock=useRef(false);
  const query=useInfiniteQuery({queryKey:['check-list',profile?.tenantId,profile?.id,owner],initialPageParam:null as string|null,
    queryFn:async({pageParam,signal})=>{
      const value=await request((owner?'/v1/me/check-requests':'/v1/vehicle-checks')+(pageParam?'?cursor='+pageParam:''),{signal});
      return z.object({items:z.array(owner?inboxItem:checkResult),nextCursor:z.uuid().nullable()}).parse(value);
    },getNextPageParam:page=>page.nextCursor??undefined,enabled:focused,retry:false,gcTime:0,refetchOnMount:'always',refetchInterval:5000});
  async function decide(id:string,decision:'approved'|'refused'){
    if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);setSaved(null);
    const generation=pin.generation.current;
    try{let proof:string|undefined;
      if(pinStatus.data?.policyEnabled){proof=await requestPinProof(request,{requestId:id,decision},pin.pin);if(generation!==pin.generation.current)throw new Error();}
      pin.clear();const reply=z.object({id:z.uuid(),outcome:z.enum(['approved','refused']),sampleOnly:z.literal(true)}).strict().parse(
      await request('/v1/me/check-requests/'+id+'/decision',{method:'POST',body:{decision,...(proof?{proof}:{})}}));
      if(reply.id!==id||reply.outcome!==decision)throw new Error();setSaved(id);await query.refetch();}
    catch(e){setError(e);await query.refetch();}finally{pin.clear();setSelected(null);lock.current=false;setBusy(false);}
  }
  function choose(id:string,decision:'approved'|'refused'){
    pin.clear();if(pinStatus.data?.policyEnabled)setSelected({id,decision});else void decide(id,decision);
  }
  const pinUnavailable=owner&&(pinStatus.isPending||pinStatus.isError||!!pinStatus.data?.policyEnabled&&(!pinStatus.data.configured||!pinStatus.data.phoneCurrent));
  const items=!query.isError&&!query.isRefetching?query.data?.pages.flatMap(p=>p.items)??[]:[];
  return <Page><Heading>{t(owner?'m2.inbox':'m2.checkHistory')}</Heading><Notice>{t('m2.development')}</Notice>
    {query.isPending&&<Copy>{t('devAuth.loading')}</Copy>}{query.isError&&<WorkflowError error={query.error}/>} {error!==undefined&&<WorkflowError error={error}/>}
    {saved&&<Notice>{t('m2.decisionSaved')} {saved}</Notice>}
    {owner&&pinStatus.isError&&<WorkflowError error={pinStatus.error}/>}
    {owner&&pinStatus.data?.policyEnabled&&(!pinStatus.data.configured||!pinStatus.data.phoneCurrent)&&<Notice>{t('ownerPin.setup')}</Notice>}
    {!query.isPending&&!query.isError&&items.length===0&&<Notice>{t('m2.empty')}</Notice>}
    {items.map(item=><Card key={item.id}><Copy selectable>{item.id}</Copy>
      {'plate' in item&&<Label>{item.plate??t('ownedVehicles.noPlate')}</Label>}
      <Copy>{new Date(item.responseDeadlineAt).toLocaleString()}</Copy>
      {owner?<><Action label={t('m2.approve')} disabled={busy||pinUnavailable||Date.parse(item.responseDeadlineAt)<=now} onPress={()=>choose(item.id,'approved')}/>
        <Action danger label={t('m2.refuse')} disabled={busy||pinUnavailable||Date.parse(item.responseDeadlineAt)<=now} onPress={()=>choose(item.id,'refused')}/>
        {selected?.id===item.id&&<><Copy>{t(selected.decision==='approved'?'ownerPin.confirmApprove':'ownerPin.confirmRefuse')}</Copy>
          <PinEntry value={pin.pin} onChange={pin.setPin} disabled={busy}/>
          <Action label={t(selected.decision==='approved'?'m2.approve':'m2.refuse')} disabled={busy||!pinInput(pin.pin)||Date.parse(item.responseDeadlineAt)<=now}
            onPress={()=>void decide(selected.id,selected.decision)}/>
          <Action secondary label={t('ownerPin.cancel')} disabled={busy} onPress={()=>{pin.clear();setSelected(null);}}/></>}
        </>
        :<Action secondary label={t('m2.result')} onPress={()=>router.push({pathname:'/live-checks/[id]',params:{id:item.id}})}/>}</Card>)}
    {query.hasNextPage&&<Action secondary label={t('ownedVehicles.loadMore')} disabled={query.isFetching} onPress={()=>void query.fetchNextPage()}/>}
    <Action secondary label={t('ownedVehicles.refresh')} disabled={query.isFetching} onPress={()=>void query.refetch()}/>
    {owner&&<Action secondary label={t('ownerPin.title')} onPress={()=>router.push('/owner-pin')}/>}
    <Action secondary label={t('devAuth.account')} onPress={()=>router.replace('/live-account')}/>
  </Page>;
}
