import {useRef,useState} from 'react';
import {TextInput,View} from 'react-native';
import {useRouter} from 'expo-router';
import {useInfiniteQuery,useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';
import {useSession} from '@/features/auth/SessionProvider';
import {useScreenFocused} from '@/features/checks/Screens';
import {Action,AppHeader,Card,Copy,Heading,Label,Notice,StitchPage,stitchStyles as u} from '@/components/ui/Stitch';
import {readVehiclePage} from '@/features/vehicles/contracts';
import {paymentListSchema,settingsSchema,subscriptionsSchema,type Payment} from './contracts';
import {PaymentPanel,PaymentReceipt} from './PaymentPanel';

export default function BillingScreen(){const {profile}=useSession();return <Billing key={profile?.tenantId+':'+profile?.id}/>;}
function Billing(){
 const {t}=useTranslation(),router=useRouter(),{profile,request}=useSession(),focused=useScreenFocused();
 const [section,setSection]=useState<'history'|'subscriptions'|'settings'|'reconciliation'>('history'),[selected,setSelected]=useState<Payment|null>(null),[vehicle,setVehicle]=useState<string|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(false),lock=useRef(false);
 const admin=!!profile?.roles.some(r=>r.code==='TENANT_ADMIN'&&r.organizationId===null),owner=!!profile?.roles.some(r=>r.code==='OWNER'&&r.organizationId===null);
 const payments=useQuery({queryKey:['billing-history',profile?.tenantId,profile?.id,section],queryFn:async({signal})=>paymentListSchema.parse(await request('/v1/billing/'+(section==='reconciliation'?'reconciliation':'payments'),{signal})),enabled:focused&&!!profile&&['history','reconciliation'].includes(section)&&(section!=='reconciliation'||admin),gcTime:0,retry:false});
 const subscriptions=useQuery({queryKey:['billing-subscriptions',profile?.tenantId,profile?.id],queryFn:async({signal})=>subscriptionsSchema.parse(await request('/v1/billing/subscriptions',{signal})),enabled:focused&&owner&&section==='subscriptions',gcTime:0,retry:false});
 const vehicles=useInfiniteQuery({queryKey:['billing-vehicles',profile?.tenantId,profile?.id],initialPageParam:undefined as string|undefined,
   queryFn:({signal,pageParam})=>readVehiclePage(request,pageParam,signal),getNextPageParam:page=>page.nextCursor??undefined,
   enabled:focused&&owner&&section==='subscriptions',gcTime:0,retry:false});
 async function reconcile(id:string){if(lock.current||!admin||!focused)return;lock.current=true;setBusy(true);setError(false);
   try{await request('/v1/billing/payments/'+id+'/reconcile',{method:'POST',body:{}});await payments.refetch();}catch{setError(true);}finally{lock.current=false;setBusy(false);}}
 return <View style={{flex:1}}><AppHeader/><StitchPage><Heading>{t('billing.title')}</Heading><Notice tone="warning">{t('billing.sample')}</Notice>
   {(['history',...(owner?['subscriptions']:[]),...(admin?['settings','reconciliation']:[])] as const).map(s=><Action key={s} secondary label={t('billing.'+s)} onPress={()=>{setSection(s as typeof section);setSelected(null);setVehicle(null);}}/>)}
   {['history','reconciliation'].includes(section)&&<>{payments.isPending&&<Copy>{t('devAuth.loading')}</Copy>}{payments.isError&&<Notice tone="danger">{t('billing.setup')}</Notice>}
     {!payments.isError&&payments.data?.items.length===0&&<Copy>{t('billing.empty')}</Copy>}
     {section==='reconciliation'&&<Notice>{t('billing.reconciliationNotice')}</Notice>}
     {error&&<Notice tone="danger">{t('billing.error')}</Notice>}
     {!payments.isError&&payments.data?.items.map(p=><Card key={p.id}><PaymentReceipt payment={p}/>
       {section==='history'&&['CREATED','PROCESSING'].includes(p.status)&&<Action secondary label={t('billing.resume')} onPress={()=>setSelected(p)}/>}
       {section==='reconciliation'&&!['COMPLETED','FAILED'].includes(p.status)&&<Action secondary label={t('billing.refresh')} disabled={busy} onPress={()=>void reconcile(p.id)}/>}</Card>)}
     {selected&&<PaymentPanel key={selected.id} purpose={selected.purpose} targetId={selected.targetId} targetRevision={selected.targetRevision} existing={selected}/>}
     {selected?.purpose==='CHECK'&&<Action secondary label={t('navigation.check')} onPress={()=>router.push({pathname:'/live-checks',params:{billingKey:selected.targetId}})}/>}
     <Action secondary label={t('billing.refresh')} disabled={payments.isFetching} onPress={()=>void payments.refetch()}/>
   </>}
   {section==='subscriptions'&&<>{(subscriptions.isPending||vehicles.isPending)&&<Copy>{t('devAuth.loading')}</Copy>}
     {(subscriptions.isError||vehicles.isError)&&<Notice tone="danger">{t('billing.error')}</Notice>}
     {!subscriptions.isError&&subscriptions.data?.reminders.map(r=><Notice key={r.id}>{t('billing.reminder')} {r.vehicleId}</Notice>)}
     {!subscriptions.isError&&subscriptions.data?.items.map(s=><Card key={s.vehicleId}><Copy selectable>{s.vehicleId}</Copy><Copy>{t('billing.states.'+s.state)}</Copy>
       <Label>{t('billing.expires')}</Label><Copy>{new Date(s.expiresAt).toLocaleString()}</Copy><Label>{t('billing.grace')}</Label><Copy>{new Date(s.graceUntil).toLocaleString()}</Copy></Card>)}
     {!vehicles.isError&&vehicles.data?.pages.flatMap(page=>page.items).map(v=><Action key={v.id} secondary label={t('billing.renew')+' · '+(v.plate??v.chassisIdentifier)} onPress={()=>setVehicle(v.id)}/>)}
     {vehicles.hasNextPage&&<Action secondary label={t('ownedVehicles.loadMore')} disabled={vehicles.isFetching} onPress={()=>void vehicles.fetchNextPage()}/>}
     {vehicle&&<PaymentPanel key={vehicle} purpose="SUBSCRIPTION" targetId={vehicle}/>}
     <Notice>{t('billing.subscriptionNotice')}</Notice><Action secondary label={t('billing.refresh')} disabled={subscriptions.isFetching||vehicles.isFetching} onPress={()=>{void subscriptions.refetch();void vehicles.refetch();}}/>
   </>}
   {section==='settings'&&admin&&<Settings/>}
   <Action secondary label={t('devAuth.account')} onPress={()=>router.replace('/live-account')}/>
 </StitchPage></View>;
}
const amountKeys=['registrationFee','checkFee','renewalFee'] as const,numberKeys=['freeMonthly','periodDays','graceDays','reminderDays'] as const;
function Settings(){
 const {t}=useTranslation(),{profile,request}=useSession(),focused=useScreenFocused(),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false),lock=useRef(false);
 const [form,setForm]=useState<Record<string,string>>({}),[enabled,setEnabled]=useState(false),[currency,setCurrency]=useState<'CDF'|'USD'>('CDF');
 const query=useQuery({queryKey:['billing-settings-admin',profile?.tenantId,profile?.id],queryFn:async({signal})=>settingsSchema.parse(await request('/v1/billing/settings',{signal})),enabled:focused,gcTime:0,retry:false});
 function edit(){const values:Record<string,string>={};for(const key of [...amountKeys,...numberKeys])values[key]=String(query.data?.[key]??'');setForm(values);setEnabled(query.data?.sandboxEnabled??false);setCurrency(query.data?.currency??'CDF');setEditing(true);}
 async function save(){if(lock.current||!focused)return;lock.current=true;setBusy(true);setError(false);
   try{const body:Record<string,unknown>={sandboxEnabled:enabled,currency,policyAcknowledged:false};for(const key of amountKeys)body[key]=form[key];for(const key of numberKeys)body[key]=Number(form[key]);
     const result=settingsSchema.parse(await request('/v1/billing/settings',{method:'PUT',body:{expectedRevision:query.data?.revision??0,settings:body}}));
     if(!result)throw new Error();setEditing(false);await query.refetch();
   }catch{setError(true);await query.refetch();}finally{lock.current=false;setBusy(false);}}
 return <Card><Heading>{t('billing.settings')}</Heading><Notice>{t('billing.policy')}</Notice>
   {query.isPending&&<Copy>{t('devAuth.loading')}</Copy>}{(error||query.isError)&&<Notice tone="danger">{t('billing.error')}</Notice>}
   {!editing&&!query.isPending&&!query.isError&&<><Copy>{query.data?t('billing.revision')+': '+query.data.revision:t('billing.setup')}</Copy>
     {query.data&&[...amountKeys,...numberKeys].map(key=><Copy key={key}>{t('billing.fields.'+key)}: {query.data![key]}</Copy>)}
     <Action secondary label={t('billing.edit')} onPress={edit}/></>}
   {editing&&<><Action secondary label={t(enabled?'billing.disable':'billing.enable')} disabled={busy} onPress={()=>setEnabled(!enabled)}/>
     <Action secondary label={currency} disabled={busy} onPress={()=>setCurrency(currency==='CDF'?'USD':'CDF')}/>
     {[...amountKeys,...numberKeys].map(key=><View key={key}><Label>{t('billing.fields.'+key)}</Label><TextInput style={u.input} accessibilityLabel={t('billing.fields.'+key)}
       value={form[key]} editable={!busy} keyboardType="decimal-pad" maxLength={20} onChangeText={v=>setForm(old=>({...old,[key]:v}))}/></View>)}
     <Action label={t('billing.save')} disabled={busy||Object.values(form).some(v=>!v.trim())} onPress={()=>void save()}/>
     <Action secondary label={t('billing.cancel')} disabled={busy} onPress={()=>setEditing(false)}/></>}
 </Card>;
}
