import {useRef,useState} from 'react';
import {TextInput,View} from 'react-native';
import {useRouter} from 'expo-router';
import {randomUUID} from 'expo-crypto';
import {useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';
import {z} from 'zod';
import {useSession} from '@/features/auth/SessionProvider';
import {ApiError} from '@/services/api/client';
import {Action,AppHeader,Card,Copy,Heading,Label,Notice,StitchPage,stitchStyles as u} from '@/components/ui/Stitch';
import {useScreenFocused} from '@/features/checks/Screens';

const sections=['organizations','agents','seals','configuration','history'] as const;
type Section=typeof sections[number];
const revision=z.number().int().positive();
const organization=z.object({id:z.uuid(),name:z.string(),type:z.string(),status:z.enum(['ACTIVE','SUSPENDED']),revision}).strict();
const agent=z.object({id:z.uuid(),agentId:z.uuid(),organizationId:z.uuid(),status:z.enum(['ACTIVE','SUSPENDED','REVOKED']),revision}).strict();
const seal=z.object({id:z.uuid(),code:z.string(),type:z.enum(['STANDARD','ALARM']),status:z.enum(['IN_STOCK','ACTIVE','REVOKED','DESTROYED']),origin:z.enum(['DEVELOPMENT','PRODUCTION']),organizationId:z.uuid(),agentId:z.uuid(),revision,allocated:z.boolean()}).strict();
const config=z.object({revision,enabled:z.boolean(),incidentPolicyEn:z.string(),incidentPolicyFr:z.string(),emergencyContact:z.string().nullable()}).strict();
const event=z.object({sequence:z.string(),actorId:z.uuid(),action:z.enum(['ORGANIZATION_STATUS','AGENT_STATUS','SEAL_ALLOCATE','SEAL_RECONCILE','CONFIGURE']),targetId:z.uuid(),payload:z.record(z.string(),z.unknown()),result:z.record(z.string(),z.unknown()),createdAt:z.string()}).strict();
const schemas={organizations:organization,agents:agent,seals:seal,configuration:config,history:event};
type Item=z.infer<typeof organization>|z.infer<typeof agent>|z.infer<typeof seal>|z.infer<typeof config>|z.infer<typeof event>;
type Change={action:string;targetId:string;expectedRevision:number;payload:Record<string,unknown>};
type Edit={action:string;item:Item};

export default function PilotAdministrationScreen(){
 const {profile}=useSession();
 return <PilotAdministration key={profile?.tenantId+':'+profile?.id}/>;
}
function PilotAdministration(){
 const {t}=useTranslation(),router=useRouter(),{profile,request}=useSession(),focused=useScreenFocused();
 const copy=(key:string)=>t('pilotAdministration.'+key);
 const [section,setSection]=useState<Section>('organizations'),[offset,setOffset]=useState(0),[edit,setEdit]=useState<Edit|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[saved,setSaved]=useState(false),[uncertain,setUncertain]=useState(false);
 const [result,setResult]=useState<Record<string,unknown>|null>(null);
 const pending=useRef<{key:string;body:Change}|null>(null),lock=useRef(false);
 const allowed=Boolean(profile?.roles.some(r=>r.code==='TENANT_ADMIN'&&r.organizationId===null));
 const query=useQuery({queryKey:['pilot-administration',profile?.tenantId,profile?.id,section,offset],enabled:allowed&&focused&&!edit,retry:false,gcTime:0,refetchOnMount:'always',
 queryFn:async({signal})=>{
   const data=z.object({section:z.literal(section),items:z.array(schemas[section]),limit:z.literal(20),offset:z.literal(offset)}).strict().parse(await request('/v1/pilot-administration?section='+section+'&limit=20&offset='+offset,{signal}));
   return data.items as Item[];
 }});
 async function save(body?:Change){
   if(lock.current||!allowed||!focused)return;
   if(!pending.current){if(!body)return;pending.current={key:randomUUID(),body};}
   lock.current=true;setBusy(true);setError(null);setSaved(false);
   try{
     const value=z.record(z.string(),z.unknown()).parse(await request('/v1/pilot-administration',{method:'POST',idempotencyKey:pending.current.key,body:pending.current.body}));
     pending.current=null;setUncertain(false);setEdit(null);setSaved(true);setResult(value);await query.refetch();
   }catch(e){setError(e);if(e instanceof ApiError&&[400,401,403,404,409].includes(e.status)){pending.current=null;setUncertain(false);setEdit(null);void query.refetch();}else setUncertain(true);}
   finally{lock.current=false;setBusy(false);}
 }
 function select(action:string,item:Item){setSaved(false);setResult(null);setError(null);setEdit({action,item});}
 function failure(e:unknown){return e instanceof ApiError?(e.status===409?'conflict':e.status===503?'setup':[401,403,404].includes(e.status)?'denied':'failed'):'failed';}
 const items=!query.isFetching&&!query.isError?query.data:undefined;
 return <View style={{flex:1}}><AppHeader/><StitchPage><Heading>{copy('title')}</Heading><Copy style={{fontSize:16,lineHeight:24}}>{copy('policy')}</Copy>
 {!allowed?<Notice tone="danger">{copy('denied')}</Notice>:<>
 {error&&<Notice tone="danger">{copy(failure(error))}</Notice>}{saved&&<Notice>{copy('saved')}</Notice>}
 {result&&typeof result.discrepancy==='number'&&<Card><Copy>{copy('expectedCount')}: {String(result.expectedCount)}</Copy><Copy>{copy('observedCount')}: {String(result.observedCount)}</Copy><Copy>{copy('discrepancy')}: {result.discrepancy}</Copy></Card>}
 {uncertain&&<><Notice tone="warning">{copy('uncertain')}</Notice><Action disabled={busy} label={copy('retry')} onPress={()=>void save()}/></>}
 {edit?<Editor key={edit.action+('id' in edit.item?edit.item.id:'config')} edit={edit} tenant={profile!.tenantId} disabled={busy||uncertain} copy={copy} save={body=>void save(body)} cancel={()=>setEdit(null)}/>:
 <>
 <View style={{gap:8}}>{sections.map(s=><Action secondary key={s} label={copy(s)} disabled={busy||section===s} onPress={()=>{setSection(s);setOffset(0);setSaved(false);setResult(null);}}/>)}</View>
 {query.isFetching&&<Copy>{copy('loading')}</Copy>}{query.isError&&<Notice tone="danger">{copy(failure(query.error))}</Notice>}
 {items?.length===0&&<Copy>{copy('empty')}</Copy>}
 {section==='configuration'&&<Notice>{copy('configPolicy')}</Notice>}
 {items?.map((item,index)=><Card key={'id'in item?item.id:'sequence'in item?item.sequence:index}>
 {'name'in item&&<Heading>{item.name}</Heading>}
 {'code'in item&&<Heading>{item.code}</Heading>}
 {'agentId'in item&&<Copy selectable>{copy('agentId')}: {item.agentId}</Copy>}
 {'organizationId'in item&&<Copy selectable>{copy('organizationId')}: {item.organizationId}</Copy>}
 {'id'in item&&<Copy selectable>{copy('reference')}: {item.id}</Copy>}
 {'revision'in item&&<Copy>{copy('revision')}: {item.revision}</Copy>}
 {'status'in item&&<Label>{copy(item.status)}</Label>}
 {'origin'in item&&<Copy>{copy(item.origin==='PRODUCTION'?'production':'development')} · {copy(item.type)}</Copy>}
 {'enabled'in item&&<><Label>{copy(item.enabled?'enabled':'disabled')}</Label><Copy>{item.incidentPolicyEn}</Copy><Copy>{item.incidentPolicyFr}</Copy><Copy>{item.emergencyContact}</Copy><Action label={copy('edit')} onPress={()=>select('CONFIGURE',item)}/></>}
 {section==='organizations'&&'status'in item&&<><Action label={copy(item.status==='ACTIVE'?'suspend':'activate')} onPress={()=>select('ORGANIZATION_STATUS',item)}/><Action secondary label={copy('reconcile')} onPress={()=>select('SEAL_RECONCILE',item)}/></>}
 {section==='agents'&&'status'in item&&<><Action label={copy(item.status==='ACTIVE'?'suspend':'activate')} onPress={()=>select('AGENT_STATUS',item)}/>{item.status!=='REVOKED'&&<Action danger label={copy('revoke')} onPress={()=>select('AGENT_REVOKE',item)}/>}</>}
 {'allocated'in item&&<><Copy>{copy(item.allocated?'allocated':'available')}</Copy>{item.status==='IN_STOCK'&&!item.allocated&&<Action label={copy('allocate')} onPress={()=>select('SEAL_ALLOCATE',item)}/>}</>}
 {'sequence'in item&&<><Heading>{copy(item.action)}</Heading><Copy selectable>{item.targetId}</Copy><Copy>{new Date(item.createdAt).toLocaleString()}</Copy>{typeof item.payload.reason==='string'&&<Copy>{item.payload.reason}</Copy>}{typeof item.payload.incidentPolicyEn==='string'&&<Copy>{item.payload.incidentPolicyEn}</Copy>}{typeof item.payload.incidentPolicyFr==='string'&&<Copy>{item.payload.incidentPolicyFr}</Copy>}{typeof item.result.discrepancy==='number'&&<Copy>{copy('discrepancy')}: {item.result.discrepancy}</Copy>}</>}
 </Card>)}
 {section==='configuration'&&items?.length===0&&<Action label={copy('edit')} onPress={()=>select('CONFIGURE',{revision:0,enabled:false,incidentPolicyEn:'',incidentPolicyFr:'',emergencyContact:null})}/>}
 {section!=='configuration'&&<><Action secondary label={copy('previous')} disabled={busy||query.isFetching||offset===0} onPress={()=>setOffset(n=>Math.max(0,n-20))}/><Action secondary label={copy('next')} disabled={busy||query.isFetching||items?.length!==20} onPress={()=>setOffset(n=>n+20)}/></>}
 <Action secondary label={copy('refresh')} disabled={busy||query.isFetching} onPress={()=>void query.refetch()}/>
 <Action secondary label={copy('reviews')} onPress={()=>router.push('/registration-reviews')}/><Action secondary label={copy('reports')} onPress={()=>router.push('/live-checks/reports')}/><Action secondary label={copy('billing')} onPress={()=>router.push('/billing')}/>
 </>}
 </>}
 <Action secondary label={copy('back')} disabled={busy} onPress={()=>router.replace('/live-account')}/>
 </StitchPage></View>;
}
function Editor({edit,tenant,disabled,copy,save,cancel}:{edit:Edit;tenant:string;disabled:boolean;copy:(key:string)=>string;save:(body:Change)=>void;cancel:()=>void}){
 const {item,action}=edit;
 const [reason,setReason]=useState(''),[agentId,setAgent]=useState('agentId'in item?item.agentId:''),[organizationId,setOrganization]=useState('organizationId'in item?item.organizationId:''),[count,setCount]=useState(''),[origin,setOrigin]=useState('PRODUCTION');
 const [enabled,setEnabled]=useState('enabled'in item?item.enabled:false),[en,setEn]=useState('incidentPolicyEn'in item?item.incidentPolicyEn:''),[fr,setFr]=useState('incidentPolicyFr'in item?item.incidentPolicyFr:''),[contact,setContact]=useState('emergencyContact'in item?item.emergencyContact??'':'');
 const field=(key:string,value:string,onChange:(v:string)=>void,multiline=false)=><View style={{gap:8}}><Label>{copy(key)}</Label><TextInput accessibilityLabel={copy(key)} editable={!disabled} value={value} onChangeText={onChange} multiline={multiline} maxLength={key.startsWith('incidentPolicy')?2000:key==='reason'?500:100} style={u.input}/></View>;
 const reasonOk=reason.trim().length>=3&&reason.trim().length<=500&&!/[\u0000-\u001f\u007f]/.test(reason);
 const valid=action==='CONFIGURE'?en.trim().length>=20&&fr.trim().length>=20&&(contact===''||contact.trim().length>=3):reasonOk&&(action!=='SEAL_ALLOCATE'||(z.uuid().safeParse(agentId).success&&z.uuid().safeParse(organizationId).success))&&(action!=='SEAL_RECONCILE'||(/^\d+$/.test(count)&&Number(count)<=1000000));
 const status=action==='AGENT_REVOKE'?'REVOKED':'status'in item&&item.status==='ACTIVE'?'SUSPENDED':'ACTIVE';
 function submit(){
 let payload:Record<string,unknown>={status,reason};
 if(action==='CONFIGURE')payload={enabled,incidentPolicyEn:en,incidentPolicyFr:fr,emergencyContact:contact.trim()||null};
 if(action==='SEAL_ALLOCATE')payload={agentId,organizationId,reason};
 if(action==='SEAL_RECONCILE')payload={observedCount:Number(count),origin,reason};
 save({action:action==='AGENT_REVOKE'?'AGENT_STATUS':action,targetId:'id'in item?item.id:tenant,expectedRevision:'revision'in item?item.revision:0,payload});
 }
 return <Card><Heading>{copy(action==='AGENT_REVOKE'?'revoke':action)}</Heading>{'id'in item&&<Copy selectable>{item.id}</Copy>}
 {action==='CONFIGURE'?<>{field('incidentPolicyEn',en,setEn,true)}{field('incidentPolicyFr',fr,setFr,true)}{field('emergencyContact',contact,setContact)}<Action secondary disabled={disabled} label={copy(enabled?'enabled':'disabled')} onPress={()=>setEnabled(v=>!v)}/><Notice>{copy('configPolicy')}</Notice></>:
 <>{action==='SEAL_ALLOCATE'&&<>{field('agentId',agentId,setAgent)}{field('organizationId',organizationId,setOrganization)}</>}
 {action==='SEAL_RECONCILE'?<><Notice>{copy('countPolicy')}</Notice>{field('observedCount',count,setCount)}<Action secondary disabled={disabled} label={copy(origin==='PRODUCTION'?'production':'development')} onPress={()=>setOrigin(v=>v==='PRODUCTION'?'DEVELOPMENT':'PRODUCTION')}/></>:action.includes('STATUS')||action==='AGENT_REVOKE'?<Label>{copy(status)}</Label>:null}
 {field('reason',reason,setReason)}</>}
 <Action label={copy('save')} disabled={disabled||!valid} onPress={submit}/><Action secondary label={copy('cancel')} disabled={disabled} onPress={cancel}/>
 </Card>;
}
