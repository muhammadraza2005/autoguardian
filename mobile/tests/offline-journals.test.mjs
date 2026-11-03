import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineJournalSync} from '../src/features/enrollment/offlineJournalSync.ts';
import {replayFrozenSubmission,FrozenSubmissionConflict} from '../src/features/enrollment/syncSubmission.ts';
import {prerequisiteCodes} from '../src/features/enrollment/submission.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('document retry retains journal, honors persisted conflict after restart and removes only confirmed attempt',async()=>{
  let ledger=null,journal={key:id(1),body:{kind:'OWNER_ID',dataBase64:'U0FNUExF',uploadContext:{draftRevision:1,ownerGeneration:1}}};
  const original=structuredClone(journal);let failure=true,time=1000,calls=0,completed=0;
  const make=()=>createOfflineJournalSync({now:()=>time,readLedger:async()=>ledger,writeLedger:async v=>{ledger=v;},
    classify:()=> 'RETRY',completed:()=>{completed++;},async *entries(){
      if(journal)yield {id:'evidence:'+id(2)+':documents',key:journal.key,
        send:async()=>{calls++;assert.deepEqual(journal,original);if(failure)throw Error('Lost connection');},remove:async()=>{journal=null;}};}});
  let worker=make();worker.configure(true,'agent');await worker.tick();assert.deepEqual(journal,original);assert.equal(completed,0);
  worker.stop();worker=make();worker.configure(true,'agent');await worker.tick();assert.equal(calls,1);
  time=31000;failure=false;await worker.tick();assert.equal(journal,null);assert.equal(completed,1);assert.deepEqual(JSON.parse(ledger),{});
});
test('journal worker fails closed on corrupt ledger and cancels on account change before removing recovery',async()=>{
  let removed=false,release,started,signal;
  let worker=createOfflineJournalSync({readLedger:async()=>'{corrupt',writeLedger:async()=>{},classify:()=> 'RETRY',
    async *entries(){yield {id:'owner:'+id(1),key:id(2),send:async()=>{throw Error('Must not send');},remove:async()=>{removed=true;}};}});
  worker.configure(true,'agent-A');await assert.rejects(worker.tick());assert.equal(removed,false);
  const began=new Promise(resolve=>{started=resolve;});
  worker=createOfflineJournalSync({readLedger:async()=>null,writeLedger:async()=>{},classify:()=> 'RETRY',
    async *entries(){yield {id:'owner:'+id(1),key:id(2),send:async abort=>{signal=abort;started();await new Promise(resolve=>{release=resolve;});},
      remove:async()=>{removed=true;}};}});
  worker.configure(true,'agent-A');const flight=worker.tick();await began;worker.configure(true,'agent-B');
  assert.equal(signal.aborted,true);release();await flight;assert.equal(removed,false);
});
test('finalization retry requires unchanged fresh snapshot and server-confirmed prerequisites',async()=>{
  const attempt={key:id(4),action:'finalize',body:{expectedDraftRevision:2,expectedSnapshotRevision:3}};
  const state={draftId:id(1),draftRevision:2,ownerGeneration:1,snapshotRevision:3,fittingRevision:1,mode:'PRODUCTION',status:'SUBMITTED',
    ownerReady:true,checks:prerequisiteCodes.map(code=>({code,status:'COMPLETE'})),vehicleId:null,canSubmit:false,canFinalize:true};
  let current=structuredClone(state),posts=[];
  const request=async(path,options)=>{if(options.method==='POST'){posts.push({path,options});return {...state,status:'ACTIVE',vehicleId:id(5),canFinalize:false};}return current;};
  current.snapshotRevision=4;
  await assert.rejects(replayFrozenSubmission(request,id(1),attempt,new AbortController().signal),FrozenSubmissionConflict);
  assert.equal(posts.length,0);
  current=structuredClone(state);current.canFinalize=false;current.checks[1].status='EXPIRED';
  await assert.rejects(replayFrozenSubmission(request,id(1),attempt,new AbortController().signal),FrozenSubmissionConflict);
  assert.equal(posts.length,0);
  current=structuredClone(state);await replayFrozenSubmission(request,id(1),attempt,new AbortController().signal);
  assert.equal(posts.length,1);assert.equal(posts[0].options.idempotencyKey,attempt.key);assert.deepEqual(posts[0].options.body,attempt.body);
  // A lost success response may be recovered through the exact server replay
  // branch, even though it is no longer legal to initiate a new finalization.
  current={...state,status:'ACTIVE',vehicleId:id(5),canFinalize:false};
  await replayFrozenSubmission(request,id(1),attempt,new AbortController().signal);
  assert.equal(posts.length,2);assert.equal(posts[1].options.idempotencyKey,attempt.key);
});
