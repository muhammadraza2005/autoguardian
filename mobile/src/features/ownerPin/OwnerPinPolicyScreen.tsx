import {useRef,useState} from 'react';
import {View} from 'react-native';
import {useRouter} from 'expo-router';
import {useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';
import {z} from 'zod';
import {useSession} from '@/features/auth/SessionProvider';
import {AppHeader,StitchPage,Heading,Copy,Action,Notice} from '@/components/ui/Stitch';
import {useScreenFocused} from '@/features/checks/Screens';
const schema=z.object({enabled:z.boolean(),maxAttempts:z.number().int(),lockSeconds:z.number().int(),proofSeconds:z.number().int(),approvalReference:z.string()}).strict();
const approved={enabled:true,maxAttempts:5,lockSeconds:900,proofSeconds:60,approvalReference:'Project-owner approval in conversation 2026-10-22'};
export default function OwnerPinPolicyScreen(){
 const {t}=useTranslation(),router=useRouter(),{request,profile}=useSession(),focused=useScreenFocused(),lock=useRef(false);
 const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[saved,setSaved]=useState(false);
 const allowed=!!profile?.roles.some(r=>r.code==='TENANT_ADMIN'&&r.organizationId===null);
 const policy=useQuery({queryKey:['owner-pin-policy',profile?.id],enabled:allowed&&focused,retry:false,gcTime:0,
  queryFn:async({signal})=>schema.nullable().parse(await request('/v1/administration/owner-pin-policy',{signal}))});
 async function enable(){if(lock.current)return;lock.current=true;setBusy(true);setFailed(false);setSaved(false);
  try{const result=schema.parse(await request('/v1/administration/owner-pin-policy',{method:'PUT',body:approved}));
   if(!result.enabled||result.maxAttempts!==5||result.lockSeconds!==900||result.proofSeconds!==60)throw new Error('Policy mismatch');
   setSaved(true);await policy.refetch();}catch{setFailed(true);}finally{lock.current=false;setBusy(false);}}
 return <View style={{flex:1}}><AppHeader/><StitchPage><Heading>{t('pinPolicy.title')}</Heading><Copy>{t('pinPolicy.description')}</Copy>
  {!allowed&&<Notice tone="danger">{t('access.description')}</Notice>}
  {policy.isPending&&allowed&&<Copy>{t('devAuth.loading')}</Copy>}
  {(failed||policy.isError)&&<Notice tone="danger">{t('pinPolicy.error')}</Notice>}
  {saved&&<Notice>{t('pinPolicy.saved')}</Notice>}
  {policy.data&&<Copy>{t(policy.data.enabled?'pinPolicy.enabled':'ownerPin.unavailable')}</Copy>}
  <Action disabled={!allowed||busy||policy.isPending||policy.isError} label={t('pinPolicy.enable')} onPress={()=>void enable()}/>
  <Action secondary label={t('devAuth.account')} onPress={()=>router.replace('/live-account')}/>
 </StitchPage></View>;
}
