import type {SealPackage} from './seals';
type Slot={position:number;sealCode:string};
export type SealChoice={code:string;type:'STANDARD'|'ALARM';status:'IN_STOCK'|'REVOKED'|'DESTROYED';available:boolean};
export function availableSealChoices(packageValue:SealPackage,position:number,slots:Slot[],stock:SealChoice[],saved:{sealCode:string;sealType:'STANDARD'|'ALARM'}[]){
  if(packageValue==='NONE')return [];
  const other=slots.filter(s=>s.position!==position && s.sealCode);
  const used=new Set(other.map(s=>s.sealCode));
  const type=(code:string)=>stock.find(s=>s.code===code)?.type??saved.find(s=>s.sealCode===code)?.sealType;
  const counts={STANDARD:other.filter(s=>type(s.sealCode)==='STANDARD').length,ALARM:other.filter(s=>type(s.sealCode)==='ALARM').length};
  const maximum=packageValue==='STANDARD'?{STANDARD:4,ALARM:0}:packageValue==='ONE_ALARM'?{STANDARD:3,ALARM:1}:{STANDARD:0,ALARM:4};
  return stock.filter(s=>s.status==='IN_STOCK' && (s.available || saved.some(p=>p.sealCode===s.code))
    && !used.has(s.code) && counts[s.type]<maximum[s.type]).sort((a,b)=>a.code.localeCompare(b.code));
}
