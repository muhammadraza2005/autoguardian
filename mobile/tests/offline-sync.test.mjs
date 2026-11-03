import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkingCopyStore} from '../src/features/enrollment/workingCopyStore.ts';
import {createOfflineSync} from '../src/features/enrollment/offlineSync.ts';
import {offlineSyncEditors} from '../src/features/enrollment/offlineSyncEditors.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope='tenant/agent';
function copy(){return {kind:'vehicle',baseRevision:null,organization:id(1),owner:id(2),key:id(3),
  fields:{chassisIdentifier:'TEST',plate:'',category:'CAR',make:'',model:'',manufactureYear:'',color:''},
  pending:{key:id(3),body:{organizationId:id(1),ownerProfileId:id(2),vehicle:{chassisIdentifier:'TEST',plate:null,
    category:'CAR',make:null,model:null,manufactureYear:null,color:null}}}};}
function fixture(){const records=new Map();const base=createWorkingCopyStore({getItem:k=>records.get(k)??null,
  setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)});base.identify(scope);
  return {store:{...base,flush:async()=>{}},records};}
test('pending retry survives restart with the exact key/body, respects backoff, reconciles only after success',async()=>{
  const f=fixture();f.store.write(scope,'new',copy());let time=1000,fail=true,reconciled=0;
  const sent=[];const make=()=>createOfflineSync({store:f.store,now:()=>time,classify:()=> 'RETRY',
    send:async entry=>{sent.push(entry.copy.pending);if(fail)throw Error('Connection lost');},completed:()=>{reconciled++;}});
  let worker=make();worker.configure(scope,true);await worker.tick();
  assert.equal(f.store.read(scope,'vehicle','new').sync.nextAttemptAt,6000);
  assert.deepEqual(f.store.read(scope,'vehicle','new').pending,copy().pending);
  // Simulate a form rerender and a process restart. Neither resets the schedule.
  f.store.write(scope,'new',copy());worker.stop();worker=make();worker.configure(scope,true);
  await worker.tick();assert.equal(sent.length,1);assert.equal(reconciled,0);
  time=6000;fail=false;await worker.tick();assert.equal(sent.length,2);
  assert.deepEqual(sent[0],sent[1]);assert.equal(f.store.read(scope,'vehicle','new'),null);assert.equal(reconciled,1);
});
test('conflicting revisions stay preserved and do not get automatically retried after restart',async()=>{
  const f=fixture();const value={...copy(),baseRevision:2,pending:{...copy().pending,revision:2}};
  f.store.write(scope,id(4),value);let requests=0;
  const make=()=>createOfflineSync({store:f.store,classify:()=> 'CONFLICT',send:async()=>{requests++;throw Error('409');}});
  let worker=make();worker.configure(scope,true);await worker.tick();
  assert.equal(f.store.read(scope,'vehicle',id(4)).sync.blocked,'CONFLICT');
  assert.deepEqual(f.store.read(scope,'vehicle',id(4)).pending,value.pending);
  worker.stop();worker=make();worker.configure(scope,true);await worker.tick();assert.equal(requests,1);
});
test('editor/account pause aborts the send and never clears uncertain original recovery',async()=>{
  const f=fixture();f.store.write(scope,'new',copy());let release,signal,started;
  const began=new Promise(resolve=>{started=resolve;});
  const worker=createOfflineSync({store:f.store,classify:()=> 'RETRY',send:async(_entry,abort)=>{
    signal=abort;started();await new Promise(resolve=>{release=resolve;});}});
  worker.configure(scope,true);const flight=worker.tick();await began;
  worker.configure(scope,false);assert.equal(signal.aborted,true);release();await flight;
  assert.deepEqual(f.store.read(scope,'vehicle','new').pending,copy().pending);
  worker.configure('different',true);await worker.tick();assert.equal(f.store.list('different').length,0);
});
test('duplicate ticks serialize sends and do not lose an edit made during a send',async()=>{
  const f=fixture();f.store.write(scope,'new',copy());let release,started,calls=0;
  const began=new Promise(resolve=>{started=resolve;});
  const worker=createOfflineSync({store:f.store,classify:()=> 'RETRY',send:async()=>{calls++;started();await new Promise(resolve=>{release=resolve;});}});
  worker.configure(scope,true);const first=worker.tick(),second=worker.tick();await began;
  const next=copy();next.pending.key=id(9);next.pending.body.vehicle.chassisIdentifier='EDITED';
  f.store.write(scope,'new',next);release();await Promise.all([first,second]);
  assert.equal(calls,1);assert.deepEqual(f.store.read(scope,'vehicle','new').pending,next.pending);
});
test('storage failure prevents network submission, and confirmed result removal failure reports recovery risk',async()=>{
  const f=fixture();f.store.write(scope,'new',copy());let calls=0;
  f.store.flush=async()=>{throw Error('Disk unavailable');};
  let worker=createOfflineSync({store:f.store,classify:()=> 'RETRY',send:async()=>{calls++;}});
  worker.configure(scope,true);await worker.tick();assert.equal(calls,0);assert.equal(worker.getSnapshot().storageFailed,true);
  const g=fixture();g.store.write(scope,'new',copy());let flushes=0;
  g.store.flush=async()=>{if(++flushes===2)throw Error('Disk unavailable');};
  worker=createOfflineSync({store:g.store,classify:()=> 'RETRY',send:async()=>{calls++;}});
  worker.configure(scope,true);await worker.tick();assert.equal(worker.getSnapshot().storageFailed,true);
});
test('editor ownership remains held until every mounted editor releases and releases are idempotent',()=>{
  const first=offlineSyncEditors.enter(),second=offlineSyncEditors.enter();assert.equal(offlineSyncEditors.active(),true);
  first();first();assert.equal(offlineSyncEditors.active(),true);second();assert.equal(offlineSyncEditors.active(),false);
});
test('queue capacity never evicts an older submitted operation to make room for a new form',()=>{
  const f=fixture();for(let n=1;n<=100;n++)f.store.write(scope,id(n),copy());
  assert.throws(()=>f.store.write(scope,id(101),copy()),/full/);
  assert.equal(f.store.list(scope).length,100);assert.deepEqual(f.store.read(scope,'vehicle',id(1)).pending,copy().pending);
});
