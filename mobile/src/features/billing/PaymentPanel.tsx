import {useCallback,useEffect,useRef,useState} from 'react';
import {AppState,TextInput} from 'react-native';
import {useFocusEffect} from 'expo-router';
import {randomUUID} from 'expo-crypto';
import {useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';
import {useSession} from '@/features/auth/SessionProvider';
import {Action,Card,Copy,Heading,Label,Notice,stitchStyles as u} from '@/components/ui/Stitch';
import {paymentSchema,livePaymentSchema,liveSettingsSchema,settingsSchema,type Payment} from './contracts';
function useFocused(){const [focused,setFocused]=useState(false),[active,setActive]=useState(AppState.currentState==='active');
  useFocusEffect(useCallback(()=>{setFocused(true);return()=>setFocused(false);},[]));
  useEffect(()=>{const sub=AppState.addEventListener('change',s=>setActive(s==='active'));return()=>sub.remove();},[]);return focused&&active;}

export function PaymentReceipt({payment}:{payment:Payment}){
  const {t}=useTranslation();return <><Copy>{t('billing.purposes.'+payment.purpose)} · {payment.amount} {payment.currency}</Copy>
    <Notice tone={payment.status==='FAILED'||payment.status==='DISCREPANCY'?'danger':'warning'}>{t((payment.sampleOnly?'billing.states.':'billing.liveStates.')+payment.status)}</Notice>
    <Copy selectable>{payment.id}</Copy>{payment.receiptNumber&&<><Label>{t(payment.sampleOnly?'billing.receipt':'billing.liveReceipt')}</Label><Copy selectable>{payment.receiptNumber}</Copy>
      <Copy>{payment.confirmedAt?new Date(payment.confirmedAt).toLocaleString():''}</Copy><Copy selectable>{payment.providerReference}</Copy></>}
    {!payment.sampleOnly&&payment.receiptIdentity&&<Copy selectable>{Object.values(payment.receiptIdentity).join('\n')}</Copy>}
  </>;
}
export function PaymentPanel({purpose,targetId,targetRevision=0,existing,production=false}:{purpose:Payment['purpose'];targetId:string;targetRevision?:number;existing?:Payment;production?:boolean}){
  const {profile}=useSession();return <ScopedPaymentPanel key={[profile?.tenantId,profile?.id,purpose,targetId,targetRevision,existing?.id,production].join(':')}
    purpose={purpose} targetId={targetId} targetRevision={targetRevision} existing={existing} production={production}/>;
}
function ScopedPaymentPanel({purpose,targetId,targetRevision,existing,production}:{purpose:Payment['purpose'];targetId:string;targetRevision:number;existing?:Payment;production:boolean}){
  const {t}=useTranslation(),{request,profile}=useSession(),focused=useFocused();
  const [phone,setPhone]=useState(''),[provider,setProvider]=useState('VODACOM_MPESA_COD'),[payment,setPayment]=useState<Payment|undefined>(existing);
  const [busy,setBusy]=useState(false),[error,setError]=useState(false),[frozen,setFrozen]=useState(false),lock=useRef(false),key=useRef<string|null>(null);
  const prefix=production?'/v1/billing/live':'/v1/billing',schema=production?livePaymentSchema:paymentSchema;
  const settings=useQuery({queryKey:['billing-settings',profile?.tenantId,profile?.id,production],queryFn:async({signal})=>{
    const value=await request(prefix+'/settings',{signal});return production?liveSettingsSchema.parse(value):settingsSchema.parse(value);
  },enabled:focused&&!!profile,gcTime:0,retry:false});
  const state=useQuery({queryKey:['billing-payment',profile?.tenantId,profile?.id,payment?.id,production],queryFn:async({signal})=>{
    const result=schema.parse(await request(prefix+'/payments/'+payment!.id,{signal}));
    if(result.id!==payment!.id||result.targetId!==targetId||result.targetRevision!==targetRevision||result.purpose!==purpose)throw new Error('Unexpected payment.');return result;
  },enabled:focused&&!!payment,gcTime:0,retry:false,refetchInterval:q=>payment&&['CREATED','PROCESSING'].includes(q.state.data?.status??payment.status)?5000:false});
  const confirmed=state.isError?undefined:state.data??payment;
  const locked=busy||!!payment;
  async function pay(){
    if(lock.current||locked||!focused)return;lock.current=true;setBusy(true);setError(false);setFrozen(true);key.current??=randomUUID();
    try{const result=schema.parse(await request(prefix+'/payments',{method:'POST',idempotencyKey:key.current,
      body:{purpose,targetId,targetRevision,phoneNumber:phone.trim(),provider}}));
      if(result.purpose!==purpose||result.targetId!==targetId||result.targetRevision!==targetRevision)throw new Error('Unexpected payment.');setPayment(result);
    }catch{setError(true);}finally{lock.current=false;setBusy(false);}
  }
  const fee=settings.data&&(purpose==='CHECK'&&'checkFee' in settings.data?settings.data.checkFee:purpose==='REGISTRATION'?settings.data.registrationFee:settings.data.renewalFee);
  const enabled=settings.data&&(production?'productionEnabled' in settings.data&&settings.data.productionEnabled:'sandboxEnabled' in settings.data&&settings.data.sandboxEnabled);
  return <Card><Heading>{t('billing.purposes.'+purpose)}</Heading><Notice tone="warning">{t(production?'billing.liveNotice':'billing.sample')}</Notice>
    {settings.isPending&&<Copy>{t('devAuth.loading')}</Copy>}
    {(settings.isError||!settings.isPending&&!enabled)&&<Notice>{t(production?'billing.liveSetup':'billing.setup')}</Notice>}
    {enabled&&settings.data&&<><Copy>{fee} {settings.data.currency}</Copy>
      {!payment&&<><Label>{t(production?'billing.livePhone':'billing.phone')}</Label><TextInput style={u.input} accessibilityLabel={t(production?'billing.livePhone':'billing.phone')} value={phone}
        onChangeText={setPhone} editable={!busy&&!frozen} keyboardType="phone-pad" maxLength={12}/>
        {['VODACOM_MPESA_COD','AIRTEL_COD','ORANGE_COD'].map(p=><Action key={p} secondary label={t('billing.operators.'+p)}
          disabled={busy||frozen} onPress={()=>setProvider(p)}/>)}<Copy>{t('billing.operators.'+provider)}</Copy>
        <Action label={t(busy?'devAuth.working':production?'billing.livePay':'billing.pay')} disabled={busy||!/^243\d{9}$/.test(phone.trim())} onPress={()=>void pay()}/></>}
    </>}
    {(error||state.isError)&&<Notice tone="danger">{t('billing.error')}</Notice>}
    {confirmed&&<PaymentReceipt payment={confirmed}/>}
    {state.data?.status==='FAILED'&&!state.isError&&<Action secondary label={t('billing.retryFailed')} disabled={state.isFetching||busy}
      onPress={()=>{setPayment(undefined);key.current=null;setFrozen(false);setError(false);}}/>}
    {payment&&<Action secondary label={t('billing.refresh')} disabled={state.isFetching} onPress={()=>void state.refetch()}/>}
  </Card>;
}
