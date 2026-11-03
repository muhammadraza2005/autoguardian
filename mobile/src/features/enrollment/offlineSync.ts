import type { WorkingCopy, WorkingCopyEntry } from './workingCopyStore.ts';

export type SyncStore = {
  list(scope:string):WorkingCopyEntry[];
  read(scope:string,kind:'vehicle'|'seals',id:string):WorkingCopy|null;
  write(scope:string,id:string,copy:WorkingCopy):void;
  remove(scope:string,kind:'vehicle'|'seals',id:string):void;
  flush():Promise<void>;
};
export type SyncState={running:boolean;pending:number;blocked:number;storageFailed:boolean};
const sameAttempt=(left:WorkingCopy|null,right:WorkingCopy)=>Boolean(left?.pending && right.pending
  && JSON.stringify({...left,sync:undefined})===JSON.stringify({...right,sync:undefined}));

// This worker only replays attempts the user already submitted. Unsaved edits,
// OTPs, PINs, payment confirmation and activation are never queued implicitly.
export function createOfflineSync(options:{store:SyncStore;now?:()=>number;
  send:(entry:WorkingCopyEntry,signal:AbortSignal)=>Promise<void>;
  completed?:(entry:WorkingCopyEntry)=>Promise<void>|void;
  classify:(error:unknown)=>'CONFLICT'|'DENIED'|'INVALID'|'RETRY';
}){
  const now=options.now??Date.now;let scope:string|null=null,allowed=false,epoch=0;
  let flight:Promise<void>|null=null,controller:AbortController|null=null;
  let state:SyncState={running:false,pending:0,blocked:0,storageFailed:false};
  const listeners=new Set<()=>void>();
  function publish(storageFailed=state.storageFailed){
    const entries=scope?options.store.list(scope).filter(e=>e.copy.pending):[];
    state={running:Boolean(flight),pending:entries.length,blocked:entries.filter(e=>e.copy.sync?.blocked).length,storageFailed};
    for(const listener of listeners)listener();
  }
  async function run(generation:number,activeScope:string){
    for(const entry of options.store.list(activeScope)){
      if(!allowed || generation!==epoch)return;
      const pending=entry.copy.pending,metadata=entry.copy.sync;
      if(!pending || (metadata?.key===pending.key && (metadata.blocked || metadata.nextAttemptAt>now())))continue;
      let persistedResult=false;
      try{
        // The snapshot must be on encrypted durable storage before any send.
        await options.store.flush();
        if(!allowed || generation!==epoch)return;
        const current=options.store.read(activeScope,entry.copy.kind,entry.id);
        if(!sameAttempt(current,entry.copy))continue;
        controller=new AbortController();
        await options.send(entry,controller.signal);
        if(!allowed || generation!==epoch)return;
        if(sameAttempt(options.store.read(activeScope,entry.copy.kind,entry.id),entry.copy)){
          options.store.remove(activeScope,entry.copy.kind,entry.id);
          persistedResult=true;
          await options.store.flush();
          // Query invalidation failure cannot resurrect a confirmed mutation.
          await Promise.resolve(options.completed?.(entry)).catch(()=>{});
        }
        publish(false);
      }catch(error){
        if(!allowed || generation!==epoch)return;
        if(persistedResult){publish(true);return;}
        const current=options.store.read(activeScope,entry.copy.kind,entry.id);
        if(!sameAttempt(current,entry.copy) || !current)continue;
        const outcome=options.classify(error);
        const attempts=Math.min(100000,(metadata?.key===pending.key?metadata.attempts:0)+1);
        const delay=Math.min(300000,5000*2**Math.min(attempts-1,6));
        options.store.write(activeScope,entry.id,{...current,sync:{key:pending.key,attempts,
          nextAttemptAt:now()+delay,blocked:outcome==='RETRY'?null:outcome}});
        try{await options.store.flush();publish(false);}catch{publish(true);return;}
        // Authorization loss stops the batch; server decisions never get retried
        // automatically. Conflict payloads remain recoverable for manual review.
        if(outcome==='DENIED')return;
      }finally{controller=null;}
    }
  }
  return {
    subscribe(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};},
    getSnapshot:()=>state,
    configure(nextScope:string|null,canSend:boolean){
      if(scope!==nextScope || allowed!==canSend){++epoch;controller?.abort();}
      scope=nextScope;allowed=canSend && Boolean(scope);publish();
    },
    tick():Promise<void>{
      if(flight)return flight;
      if(!scope || !allowed){publish();return Promise.resolve();}
      const generation=epoch,activeScope=scope;
      flight=Promise.resolve().then(()=>run(generation,activeScope)).catch(()=>{publish(true);})
        .finally(()=>{flight=null;publish();});
      publish();return flight;
    },
    stop(){++epoch;allowed=false;controller?.abort();publish();},
  };
}
