import {z} from 'zod';
type JournalEntry={id:string;key:string;send:(signal:AbortSignal)=>Promise<void>;remove:()=>Promise<void>};
const metadata=z.object({key:z.uuid(),attempts:z.number().int().min(1).max(100000),next:z.number().finite().nonnegative(),
  blocked:z.enum(['CONFLICT','DENIED','INVALID']).nullable()}).strict();
const ledgerSchema=z.record(z.string().min(1).max(256),metadata).refine(value=>Object.keys(value).length<=2000);
// Adapter-managed discovery and journals remain encrypted. This ledger contains
// only references/backoff states, never file bytes, identity fields or consent.
export function createOfflineJournalSync(options:{
  entries:(signal:AbortSignal)=>AsyncIterable<JournalEntry>;
  readLedger:()=>Promise<string|null>;writeLedger:(value:string)=>Promise<void>;
  classify:(error:unknown)=>'CONFLICT'|'DENIED'|'INVALID'|'RETRY';now?:()=>number;
  completed?:()=>Promise<void>|void;
}){
  const now=options.now??Date.now;let active=false,epoch=0,flight:Promise<void>|null=null;
  let identity:string|null=null;
  let abort:AbortController|null=null,nextScan=0;
  async function run(generation:number){
    const controller=new AbortController();abort=controller;
    const raw=await options.readLedger();
    if(!active || epoch!==generation)return;
    const ledger=ledgerSchema.parse(raw===null?{}:JSON.parse(raw));
    for await(const entry of options.entries(controller.signal)){
      if(!active || epoch!==generation)return;
      const previous=ledger[entry.id];
      if(previous?.key===entry.key && (previous.blocked || previous.next>now()))continue;
      try{
        await entry.send(controller.signal);
        if(!active || epoch!==generation)return;
        await entry.remove();
        if(!active || epoch!==generation)return;
        delete ledger[entry.id];
        await options.writeLedger(JSON.stringify(ledger));
        await Promise.resolve(options.completed?.()).catch(()=>{});
      }catch(error){
        if(!active || epoch!==generation)return;
        const outcome=options.classify(error),attempts=Math.min(100000,(previous?.key===entry.key?previous.attempts:0)+1);
        ledger[entry.id]={key:entry.key,attempts,next:now()+Math.min(300000,5000*2**Math.min(attempts-1,6)),
          blocked:outcome==='RETRY'?null:outcome};
        await options.writeLedger(JSON.stringify(ledgerSchema.parse(ledger)));
        if(outcome==='DENIED')return;
      }
    }
  }
  return {
    configure(allowed:boolean,nextIdentity:string|null=null){
      if(active!==allowed || identity!==nextIdentity){++epoch;abort?.abort();}
      if(identity!==nextIdentity)nextScan=0;
      identity=nextIdentity;active=allowed;
    },
    tick(){
      if(flight)return flight;
      if(!active || now()<nextScan)return Promise.resolve();
      const generation=epoch;
      flight=Promise.resolve().then(()=>run(generation)).finally(()=>{abort=null;flight=null;nextScan=now()+30000;});
      return flight;
    },
    stop(){++epoch;active=false;abort?.abort();},
  };
}
