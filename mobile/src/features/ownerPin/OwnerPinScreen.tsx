import {useCallback,useEffect,useRef,useState} from 'react';
import {AppState,TextInput,View} from 'react-native';
import {useFocusEffect,useRouter} from 'expo-router';
import {useTranslation} from 'react-i18next';
import {z} from 'zod';
import {useSession} from '@/features/auth/SessionProvider';
import {AppHeader,StitchPage,Heading,Copy,Card,Label,Action,Notice,stitchStyles as u} from '@/components/ui/Stitch';
import {ApiError} from '@/services/api/client';
import {PinEntry,useTransientPin,useOwnerPinStatus} from './PinEntry';
import {pinInput} from './contracts';
export default function OwnerPinScreen(){
 const {t}=useTranslation(),router=useRouter(),{request}=useSession(),entry=useTransientPin(),repeat=useTransientPin();
 const status=useOwnerPinStatus(true),[code,setCode]=useState(''),[challenge,setChallenge]=useState<string|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[saved,setSaved]=useState(false),lock=useRef(false);
 const clear=useCallback(()=>{setCode('');setChallenge(null);},[]);
 useFocusEffect(useCallback(()=>()=>clear(),[clear]));
 useEffect(()=>{const subscription=AppState.addEventListener('change',state=>{if(state!=='active')clear();});return()=>subscription.remove();},[clear]);
 async function start(){
  if(lock.current||!pinInput(entry.pin)||entry.pin!==repeat.pin)return;lock.current=true;setBusy(true);setError(undefined);
  const generation=entry.generation.current;
  try{const value=z.object({challengeId:z.uuid()}).strict().parse(await request('/v1/me/owner-pin/enrollments',{method:'POST',body:{pin:entry.pin}}));
   if(generation===entry.generation.current)setChallenge(value.challengeId);}
  catch(e){setError(e);}finally{entry.clear();repeat.clear();lock.current=false;setBusy(false);}
 }
 async function confirm(){
  if(lock.current||!challenge||!/^\d{6}$/.test(code))return;lock.current=true;setBusy(true);setError(undefined);
  try{z.object({configured:z.literal(true)}).strict().parse(await request('/v1/me/owner-pin/confirm',{method:'POST',body:{challengeId:challenge,code}}));
   setSaved(true);clear();await status.refetch();}
  catch(e){setError(e);}finally{setCode('');lock.current=false;setBusy(false);}
 }
 const unavailable=status.data&&!status.data.policyEnabled;
 return <View style={{flex:1}}><AppHeader/><StitchPage><Heading>{t('ownerPin.title')}</Heading><Copy>{t('ownerPin.intro')}</Copy>
  {status.isPending&&<Copy>{t('devAuth.loading')}</Copy>}
  {(status.isError||error!==undefined)&&<Notice tone="danger">{t(error instanceof ApiError&&error.code==='PIN_POLICY_OR_RECOVERY_REQUIRED'?'ownerPin.recovery':'ownerPin.error')}</Notice>}
  {unavailable&&<Notice>{t('ownerPin.unavailable')}</Notice>}
  {saved&&<Notice>{t('ownerPin.saved')}</Notice>}
  {status.data?.configured&&<Notice>{t(status.data.phoneCurrent?'ownerPin.configured':'ownerPin.recovery')}</Notice>}
  {status.data?.policyEnabled&&!status.data.configured&&!challenge&&<Card>
   <PinEntry value={entry.pin} onChange={entry.setPin} disabled={busy}/><PinEntry value={repeat.pin} onChange={repeat.setPin} disabled={busy} label="ownerPin.repeat"/>
   <Action label={t('ownerPin.sendCode')} disabled={busy||status.data.cooldown||!pinInput(entry.pin)||entry.pin!==repeat.pin} onPress={()=>void start()}/>
   {status.data.cooldown&&<Copy>{t('ownerPin.cooldown')}</Copy>}
  </Card>}
  {challenge&&<Card><Label>{t('ownerPin.code')}</Label><TextInput style={u.input} accessibilityLabel={t('ownerPin.code')} value={code}
   onChangeText={v=>setCode(v.replace(/\D/g,''))} secureTextEntry keyboardType="number-pad" autoComplete="off" autoCorrect={false} maxLength={6} editable={!busy}/>
   <Action label={t('ownerPin.confirm')} disabled={busy||!/^\d{6}$/.test(code)} onPress={()=>void confirm()}/>
   <Action secondary label={t('ownerPin.cancel')} disabled={busy} onPress={()=>{clear();void status.refetch();}}/></Card>}
  <Action secondary label={t('ownedVehicles.refresh')} disabled={busy} onPress={()=>void status.refetch()}/>
  <Action secondary label={t('devAuth.account')} onPress={()=>router.replace('/live-account')}/>
 </StitchPage></View>;
}
