import {useRef,useState} from 'react';
import {TextInput,View} from 'react-native';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {useQuery} from '@tanstack/react-query';
import {randomUUID} from 'expo-crypto';
import {useTranslation} from 'react-i18next';
import {z} from 'zod';
import {useSession} from '@/features/auth/SessionProvider';
import {readVehicleDetail} from '@/features/vehicles/contracts';
import {AppHeader,StitchPage,Heading,Copy,Card,Label,Action,Notice,stitchStyles as u} from '@/components/ui/Stitch';
import {WorkflowError,useScreenFocused} from './Screens';
export default function SaleScreen(){
  const {t}=useTranslation(),router=useRouter(),{request,profile}=useSession(),params=useLocalSearchParams<{id?:string}>(),focused=useScreenFocused();
  const parsed=z.uuid().safeParse(params.id),id=parsed.success?parsed.data:undefined;
  const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[saved,setSaved]=useState(false);
  const key=useRef<string|null>(null),lock=useRef(false),attempt=useRef<{expectedStatus:string;saleStatus:string;reason:string}|null>(null);
  const vehicle=useQuery({queryKey:['sale-vehicle',profile?.id,id],queryFn:({signal})=>readVehicleDetail(request,id!,signal),enabled:!!id&&focused,gcTime:0,retry:false,refetchOnMount:'always'});
  const history=useQuery({queryKey:['sale-history',profile?.id,id],queryFn:async({signal})=>z.object({items:z.array(z.object({id:z.uuid(),previousStatus:z.string(),saleStatus:z.string(),reason:z.string(),createdAt:z.string()}))}).parse(await request('/v1/me/vehicle-status/'+id+'/history',{signal})),enabled:!!id&&focused,gcTime:0,retry:false});
  async function submit(saleStatus:string){
    if(lock.current||!id||!vehicle.data)return;lock.current=true;setBusy(true);setError(undefined);setSaved(false);
    key.current??=randomUUID();attempt.current??={expectedStatus:vehicle.data.saleStatus,saleStatus,reason};
    try{await request('/v1/me/vehicle-status/'+id,{method:'POST',idempotencyKey:key.current,body:attempt.current});setSaved(true);key.current=null;attempt.current=null;await Promise.all([vehicle.refetch(),history.refetch()]);}
    catch(e){setError(e);}finally{lock.current=false;setBusy(false);}
  }
  return <View style={{flex:1}}><AppHeader/><StitchPage><Heading>{t('m2.sale')}</Heading><Notice>{t('m2.development')}</Notice>
    {vehicle.isError&&<WorkflowError error={vehicle.error}/>} {error!==undefined&&<WorkflowError error={error}/>}
    {vehicle.data&&!vehicle.isError&&<Card><Label>{vehicle.data.plate??vehicle.data.chassisIdentifier}</Label><Copy>{t('ownedVehicles.sales.'+vehicle.data.saleStatus)}</Copy>
      <Label>{t('m2.reason')}</Label><TextInput accessibilityLabel={t('m2.reason')} value={reason} onChangeText={v=>{setReason(v);key.current=null;attempt.current=null;}} editable={!busy} maxLength={500} style={u.input}/>
      <Action label={t('m2.list')} disabled={busy||reason.trim().length<3||vehicle.data.saleStatus!=='NOT_FOR_SALE'} onPress={()=>void submit('FOR_SALE')}/>
      <Action secondary label={t('m2.unlist')} disabled={busy||reason.trim().length<3||!['FOR_SALE','AGENT_SALE'].includes(vehicle.data.saleStatus)} onPress={()=>void submit('NOT_FOR_SALE')}/>
    </Card>}{saved&&<Notice>{t('m2.statusSaved')}</Notice>}
    <Heading>{t('m2.history')}</Heading>{history.isError&&<WorkflowError error={history.error}/>}
    {!history.isError&&history.data?.items.map(e=><Card key={e.id}><Copy>{new Date(e.createdAt).toLocaleString()}</Copy><Copy>{t('ownedVehicles.sales.'+e.saleStatus)}</Copy><Copy>{e.reason}</Copy></Card>)}
    <Action secondary label={t('m2.missing')} onPress={()=>router.push({pathname:'/live-checks/reports',params:{vehicleId:id}})}/>
    <Action secondary label={t('ownedVehicles.refresh')} disabled={busy} onPress={()=>{void vehicle.refetch();void history.refetch();}}/>
    <Action secondary label={t('ownedVehicles.backVehicles')} onPress={()=>router.replace('/live-vehicles')}/>
  </StitchPage></View>;
}
