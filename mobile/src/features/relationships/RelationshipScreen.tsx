import {useCallback,useEffect,useRef,useState} from 'react';
import {AppState,TextInput,View} from 'react-native';
import {useFocusEffect,useRouter} from 'expo-router';
import {CryptoDigestAlgorithm,digestStringAsync,randomUUID} from 'expo-crypto';
import {useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';
import {z} from 'zod';
import {useSession} from '@/features/auth/SessionProvider';
import {AppHeader,StitchPage,Heading,Copy,Card,Label,Action,Notice,stitchStyles as u} from '@/components/ui/Stitch';
import {useScreenFocused} from '@/features/checks/Screens';
import {readVehiclePage} from '@/features/vehicles/contracts';
import {PinEntry,useTransientPin,useOwnerPinStatus} from '@/features/ownerPin/PinEntry';
import {pinInput,requestPinProof} from '@/features/ownerPin/contracts';
import {ApiError} from '@/services/api/client';
import {relationshipPage,invitationInput,acceptedRelationship} from './contracts';
export default function RelationshipScreen(){
 const {t}=useTranslation(),router=useRouter(),{request,profile}=useSession(),focused=useScreenFocused(),pin=useTransientPin();
 const isOwner=!!profile?.roles.some(r=>r.code==='OWNER'&&r.organizationId===null),pinStatus=useOwnerPinStatus(focused&&isOwner);
 const [phone,setPhone]=useState(''),[vehicle,setVehicle]=useState<{id:string;label:string}|null>(null),[kind,setKind]=useState<'backup'|'seller'>('backup');
 const [cursor,setCursor]=useState<string>(),[challenge,setChallenge]=useState<string|null>(null),[code,setCode]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[saved,setSaved]=useState(false),lock=useRef(false),attempt=useRef<{key:string;fingerprint:string}|null>(null);
 const list=useQuery({queryKey:['vehicle-relationships',profile?.id],enabled:focused,retry:false,gcTime:0,staleTime:0,
  queryFn:async({signal})=>relationshipPage.parse(await request('/v1/me/vehicle-relationships',{signal}))});
 const vehicles=useQuery({queryKey:['relationship-vehicles',profile?.id,cursor],enabled:focused&&isOwner,retry:false,gcTime:0,
  queryFn:({signal})=>readVehiclePage(request,cursor,signal)});
 const clear=useCallback(()=>{setCode('');setChallenge(null);setPhone('');attempt.current=null;},[]);
 useFocusEffect(useCallback(()=>()=>clear(),[clear]));
 useEffect(()=>{const s=AppState.addEventListener('change',state=>{if(state!=='active')clear();});return()=>s.remove();},[clear]);
 async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setSaved(false);setError(undefined);
  try{await action();setSaved(true);await list.refetch();}catch(e){setError(e);}finally{pin.clear();setCode('');lock.current=false;setBusy(false);}}
 async function invite(){
  const input=invitationInput.parse({vehicleId:vehicle?.id,kind,phone:phone.trim()}),fingerprint=JSON.stringify(input);
  if(attempt.current?.fingerprint!==fingerprint)attempt.current={key:randomUUID(),fingerprint};
  const key=attempt.current.key,generation=pin.generation.current;let proof:string|undefined;
  if(kind==='seller'&&pinStatus.data?.policyEnabled){
   const phoneHash=await digestStringAsync(CryptoDigestAlgorithm.SHA256,input.phone);
   proof=await requestPinProof(request,{vehicleId:input.vehicleId,requestKey:key,expectedStatus:'NOT_FOR_SALE',saleStatus:'AGENT_SALE',reason:'seller-mandate:'+phoneHash},pin.pin);
  }
  if(generation!==pin.generation.current)throw new Error('Screen no longer active');
  z.object({id:z.literal(key),state:z.enum(['invited','accepted','revoked'])}).strict().parse(await request('/v1/me/vehicle-relationships',{method:'POST',idempotencyKey:key,body:{...input,...(proof?{proof}:{})}}));
  attempt.current=null;setPhone('');
 }
 async function accept(id:string){const generation=pin.generation.current;
  const result=z.object({challengeId:z.uuid()}).strict().parse(await request('/v1/me/vehicle-relationships/'+id+'/acceptance',{method:'POST',body:{consentVersion:'alert-only-v1',accept:true}}));
  if(generation===pin.generation.current)setChallenge(result.challengeId);
 }
 const unavailable=list.error instanceof ApiError&&list.error.status===404;
 const valid=invitationInput.safeParse({vehicleId:vehicle?.id,kind,phone:phone.trim()}).success;
 const pinBlocked=kind==='seller'&&(pinStatus.isPending||pinStatus.isError||pinStatus.data?.policyEnabled&&(!pinStatus.data.configured||!pinStatus.data.phoneCurrent||!pinInput(pin.pin)));
 return <View style={{flex:1}}><AppHeader/><StitchPage><Heading>{t('relationships.title')}</Heading><Copy>{t('relationships.intro')}</Copy><Copy>{t('relationships.duration')}</Copy><Notice>{t('m2.development')}</Notice>
  {unavailable&&<Notice>{t('relationships.unavailable')}</Notice>}
  {((list.isError&&!unavailable)||error!==undefined||vehicles.isError)&&<Notice tone="danger">{t('relationships.error')}</Notice>}
  {saved&&<Notice>{t('relationships.saved')}</Notice>}
  {isOwner&&!unavailable&&<Card><Label>{t('relationships.choose')}</Label>
   {vehicles.data?.items.map(v=><Action key={v.id} secondary disabled={busy||v.recordStatus!=='ACTIVE'||kind==='seller'&&v.saleStatus!=='NOT_FOR_SALE'} label={v.plate??v.chassisIdentifier} onPress={()=>setVehicle({id:v.id,label:v.plate??v.chassisIdentifier})}/>)}
   {vehicles.data?.nextCursor&&<Action secondary label={t('relationships.more')} disabled={busy} onPress={()=>setCursor(vehicles.data!.nextCursor!)}/>}
   {vehicle&&<Copy>{t('relationships.selected')}: {vehicle.label}</Copy>}
   <Action secondary disabled={busy} label={t('relationships.backup')} onPress={()=>setKind('backup')}/><Action secondary disabled={busy} label={t('relationships.seller')} onPress={()=>{setKind('seller');setVehicle(null);}}/>
   <Label>{t('relationships.'+kind)}</Label><Label>{t('relationships.phone')}</Label><TextInput accessibilityLabel={t('relationships.phone')} style={u.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="off" autoCorrect={false} maxLength={16} editable={!busy}/>
   {kind==='seller'&&pinStatus.data?.policyEnabled&&<PinEntry value={pin.pin} onChange={pin.setPin} disabled={busy}/>}
   <Action label={t('relationships.invite')} disabled={busy||!valid||!!pinBlocked||list.isError||list.isPending} onPress={()=>void run(invite)}/>
  </Card>}
  {list.isPending&&<Copy>{t('devAuth.loading')}</Copy>}
  {list.data?.items.length===0&&<Copy>{t('relationships.empty')}</Copy>}
  {!list.isError&&list.data?.items.map(r=><Card key={r.id}><Label>{r.plate??t('relationships.'+r.kind)}</Label><Copy>{t('relationships.'+r.kind)} — {t('relationships.states.'+r.state)}</Copy>
   {!r.current&&r.state!=='revoked'&&<Copy>{t('relationships.stale')}</Copy>}
   {r.expiresAt&&<Copy>{new Date(r.expiresAt).toLocaleDateString()}</Copy>}
   {!r.asOwner&&r.current&&r.state==='invited'&&<><Copy>{t('relationships.'+(r.kind==='backup'?'backupConsent':'sellerConsent'))}</Copy><Action disabled={busy||!!challenge} label={t('relationships.accept')} onPress={()=>void run(()=>accept(r.id))}/></>}
   {r.state!=='revoked'&&<Action secondary disabled={busy} label={t('relationships.revoke')} onPress={()=>void run(async()=>{z.literal(true).parse(await request('/v1/me/vehicle-relationships/'+r.id+'/revoke',{method:'POST',body:{}}));})}/>}
  </Card>)}
  {challenge&&<Card><Label>{t('relationships.code')}</Label><TextInput accessibilityLabel={t('relationships.code')} value={code} onChangeText={v=>setCode(v.replace(/\D/g,''))} secureTextEntry keyboardType="number-pad" style={u.input} maxLength={6} autoComplete="off" autoCorrect={false} editable={!busy}/>
   <Action disabled={busy||!/^\d{6}$/.test(code)} label={t('relationships.confirm')} onPress={()=>void run(async()=>{acceptedRelationship.parse(await request('/v1/me/vehicle-relationships/confirm',{method:'POST',body:{challengeId:challenge,code}}));setChallenge(null);})}/>
   <Action secondary disabled={busy} label={t('ownerPin.cancel')} onPress={()=>{setChallenge(null);setCode('');}}/></Card>}
  <Action secondary disabled={busy} label={t('ownedVehicles.refresh')} onPress={()=>void list.refetch()}/><Action secondary label={t('devAuth.account')} onPress={()=>router.replace('/live-account')}/>
 </StitchPage></View>;
}
