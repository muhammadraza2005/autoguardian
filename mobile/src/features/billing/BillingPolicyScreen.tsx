import {useRef,useState} from 'react';
import {TextInput,View} from 'react-native';
import {useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';
import {useSession} from '../auth/SessionProvider';
import {useScreenFocused} from '../checks/Screens';
import {Action,AppHeader,Card,Copy,Heading,Label,Notice,StitchPage,stitchStyles as u} from '@/components/ui/Stitch';
import {z} from 'zod';
const textFields=['approvalReference','billingRevision','receiptValidityDays','offlineHours','businessName','address','registrationNumber','smsEn','smsFr'] as const;
const booleanFields=['productionEnabled','graceAccess','smsEnabled','offlineEnabled','protectedFeatures'] as const;
const policySchema=z.object({productionEnabled:z.boolean(),billingRevision:z.number().int().positive(),approvalReference:z.string(),receiptValidityDays:z.number().int().positive(),
 graceAccess:z.boolean(),protectedFeatures:z.array(z.literal('institutional_lock')),smsEnabled:z.boolean(),smsEn:z.string(),smsFr:z.string(),
 receiptIdentity:z.object({businessName:z.string(),address:z.string(),registrationNumber:z.string()}).strict(),offlineEnabled:z.boolean(),offlineHours:z.number().int().nonnegative()}).strict();
const configurationSchema=z.object({revision:z.number().int().positive(),policy:policySchema,approvedAt:z.string()}).strict().nullable();
export default function BillingPolicyScreen(){const {profile}=useSession();return <Policy key={profile?.tenantId+':'+profile?.id}/>;}
function Policy(){
 const {profile,request}=useSession(),{t}=useTranslation(),focused=useScreenFocused();
 const admin=profile?.roles.some(r=>r.code==='TENANT_ADMIN'&&r.organizationId===null);
 const query=useQuery({queryKey:['billing-policy',profile?.tenantId,profile?.id],queryFn:async({signal})=>configurationSchema.parse(await request('/v1/billing/operations/policy',{signal})),enabled:focused&&!!admin,gcTime:0,retry:false});
 const [form,setForm]=useState<Record<string,string>>({}),[flags,setFlags]=useState<Record<string,boolean>>({}),[revision,setRevision]=useState<number|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(false),[source,setSource]=useState(''),[rows,setRows]=useState(''),[results,setResults]=useState<{depositId:string;result:string}[]|null>(null),lock=useRef(false);
 function edit(){
  const values:Record<string,string>={},nextFlags:Record<string,boolean>={},p=query.data?.policy;
  for(const k of textFields)values[k]=String(k==='businessName'||k==='address'||k==='registrationNumber'?p?.receiptIdentity[k]??'':p?.[k]??'');
  for(const k of booleanFields)nextFlags[k]=k==='protectedFeatures'?!!p?.protectedFeatures.length:!!p?.[k];
  setForm(values);setFlags(nextFlags);setRevision(query.data?.revision??0);setError(false);
 }
 async function save(){if(lock.current||!focused||revision===null)return;lock.current=true;setBusy(true);setError(false);
  try{
   const policy=policySchema.parse({...flags,protectedFeatures:flags.protectedFeatures?['institutional_lock']:[],approvalReference:form.approvalReference,
    billingRevision:Number(form.billingRevision),receiptValidityDays:Number(form.receiptValidityDays),offlineHours:Number(form.offlineHours),smsEn:form.smsEn,smsFr:form.smsFr,
    receiptIdentity:{businessName:form.businessName,address:form.address,registrationNumber:form.registrationNumber}});
   configurationSchema.parse(await request('/v1/billing/operations/policy',{method:'PUT',body:{expectedRevision:revision,policy}}));setRevision(null);await query.refetch();
  }catch{setError(true);await query.refetch();}finally{lock.current=false;setBusy(false);}
 }
 async function importStatement(){if(lock.current||!focused)return;lock.current=true;setBusy(true);setError(false);setResults(null);
  try{const result=z.object({items:z.array(z.object({depositId:z.uuid(),result:z.enum(['MATCHED','UNKNOWN_PAYMENT','AMOUNT_OR_CURRENCY','STATUS','PROVIDER_REFERENCE'])}).strict())}).strict()
    .parse(await request('/v1/billing/operations/settlements',{method:'POST',body:{sourceReference:source,items:JSON.parse(rows)}}));setResults(result.items);
  }catch{setError(true);}finally{lock.current=false;setBusy(false);}
 }
 return <View style={{flex:1}}><AppHeader/><StitchPage><Heading>{t('billing.policyTitle')}</Heading>
  {!admin?<Notice>{t('offlineSync.locked')}</Notice>:<><Notice>{t('billing.policyNotice')}</Notice>
   {(error||query.isError)&&<Notice tone="danger">{t('billing.error')}</Notice>}
   {query.isPending&&<Copy>{t('devAuth.loading')}</Copy>}
   {!query.isPending&&!query.isError&&revision===null&&<Action secondary label={t('billing.edit')} onPress={edit}/>}
   {revision!==null&&<Card><Copy>{t('billing.revision')}: {revision}</Copy>
    {booleanFields.map(k=><Action key={k} secondary label={(flags[k]?'✓ ':'○ ')+t('billing.'+k)} disabled={busy} onPress={()=>setFlags(old=>({...old,[k]:!old[k]}))}/>)}
    {textFields.map(k=><View key={k}><Label>{t('billing.'+k)}</Label><TextInput style={u.input} accessibilityLabel={t('billing.'+k)} value={form[k]??''}
      editable={!busy} maxLength={k.startsWith('sms')?320:300} onChangeText={v=>setForm(old=>({...old,[k]:v}))}/></View>)}
    <Action label={t('billing.savePolicy')} disabled={busy} onPress={()=>void save()}/><Action secondary label={t('billing.cancel')} disabled={busy} onPress={()=>setRevision(null)}/>
   </Card>}
   <Card><Heading>{t('billing.settlements')}</Heading><Notice>{t('billing.statementNotice')}</Notice>
    <Label>{t('billing.sourceReference')}</Label><TextInput style={u.input} accessibilityLabel={t('billing.sourceReference')} value={source} onChangeText={setSource} editable={!busy} maxLength={200}/>
    <Label>{t('billing.statementItems')}</Label><TextInput style={[u.input,{minHeight:120}]} accessibilityLabel={t('billing.statementItems')} value={rows} onChangeText={setRows} editable={!busy} multiline maxLength={200000}/>
    <Action label={t('billing.importStatement')} disabled={busy||!source.trim()||!rows.trim()} onPress={()=>void importStatement()}/>
    {results?.map(r=><Copy key={r.depositId} selectable>{r.depositId}: {t('billing.settlementResults.'+r.result)}</Copy>)}
   </Card>
  </>}
 </StitchPage></View>;
}
