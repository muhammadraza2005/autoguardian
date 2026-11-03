import {useState} from 'react';
import {View} from 'react-native';
import {useRouter} from 'expo-router';
import {useQuery,useInfiniteQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';
import {useSession} from '../auth/SessionProvider';
import {useScreenFocused} from '../checks/Screens';
import {readVehiclePage} from '../vehicles/contracts';
import {Action,AppHeader,Card,Copy,Heading,Notice,StitchPage} from '@/components/ui/Stitch';
import {livePaymentListSchema,liveSubscriptionsSchema,type Payment} from './contracts';
import {PaymentPanel,PaymentReceipt} from './PaymentPanel';
export default function LiveBillingScreen(){const {profile}=useSession();return <LiveBilling key={profile?.tenantId+':'+profile?.id}/>;}
function LiveBilling(){
 const {request,profile}=useSession(),{t}=useTranslation(),router=useRouter(),focused=useScreenFocused();
 const [selected,setSelected]=useState<Payment|null>(null),[vehicle,setVehicle]=useState<string|null>(null);
 const owner=profile?.roles.some(r=>r.code==='OWNER'&&r.organizationId===null);
 const history=useQuery({queryKey:['live-billing-history',profile?.tenantId,profile?.id],queryFn:async({signal})=>livePaymentListSchema.parse(await request('/v1/billing/live/payments',{signal})),enabled:focused&&!!profile,gcTime:0,retry:false});
 const subscriptions=useQuery({queryKey:['live-billing-subscriptions',profile?.tenantId,profile?.id],queryFn:async({signal})=>liveSubscriptionsSchema.parse(await request('/v1/billing/live/subscriptions',{signal})),enabled:focused&&!!owner,gcTime:0,retry:false});
 const vehicles=useInfiniteQuery({queryKey:['live-billing-vehicles',profile?.tenantId,profile?.id],initialPageParam:undefined as string|undefined,
  queryFn:({signal,pageParam})=>readVehiclePage(request,pageParam,signal),getNextPageParam:page=>page.nextCursor??undefined,enabled:focused&&!!owner,gcTime:0,retry:false});
 return <View style={{flex:1}}><AppHeader/><StitchPage><Heading>{t('billing.liveTitle')}</Heading>
  {!profile&&<Notice>{t('offlineSync.locked')}</Notice>}
  {history.isPending&&profile&&<Copy>{t('devAuth.loading')}</Copy>}
  {(history.isError||subscriptions.isError)&&<Notice>{t('billing.liveSetup')}</Notice>}
  {history.data?.items.length===0&&<Copy>{t('billing.empty')}</Copy>}
  {history.data?.items.map(p=><Card key={p.id}><PaymentReceipt payment={p}/><Action secondary label={t('billing.resume')} onPress={()=>setSelected(p)}/></Card>)}
  {selected&&<PaymentPanel production purpose={selected.purpose} targetId={selected.targetId} targetRevision={selected.targetRevision} existing={selected}/>}
  {subscriptions.data?.items.map(s=><Card key={s.vehicleId}><Copy selectable>{s.vehicleId}</Copy><Notice>{t('billing.liveStates.'+s.state)}</Notice><Copy>{s.expiresAt}</Copy></Card>)}
  {subscriptions.data?.reminders.map(r=><Notice key={r.id}>{t('billing.reminder')} {r.vehicleId}</Notice>)}
  {vehicles.data?.pages.flatMap(p=>p.items).map(v=><Action key={v.id} secondary label={t('billing.purposes.SUBSCRIPTION')+' · '+(v.plate??v.chassisIdentifier)} onPress={()=>setVehicle(v.id)}/>)}
  {vehicles.hasNextPage&&<Action secondary label={t('ownedVehicles.loadMore')} disabled={vehicles.isFetching} onPress={()=>void vehicles.fetchNextPage()}/>}
  {vehicle&&<PaymentPanel production purpose="SUBSCRIPTION" targetId={vehicle}/>}
  <Action secondary label={t('billing.refresh')} onPress={()=>{void history.refetch();if(owner)void subscriptions.refetch();}}/>
  <Action secondary label={t('devAuth.account')} onPress={()=>router.replace('/live-account')}/>
 </StitchPage></View>;
}
