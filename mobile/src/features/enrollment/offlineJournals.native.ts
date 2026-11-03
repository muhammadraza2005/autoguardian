import {z} from 'zod';
import {ApiError,type AuthenticatedRequest} from '@/services/api/client';
import {nativeVault} from './nativeVault.native';
import {createOfflineJournalSync} from './offlineJournalSync';
import {readDraftPage} from './drafts';
import {loadPendingEvidence,removePendingEvidence} from './nativeEvidence.native';
import {uploadEvidence} from './evidence';
import {loadOwnerRecovery,removeOwnerRecovery} from './ownerRecovery.native';
import {saveOwner,recordOwnerConsent} from './owner';
import {loadReviewRecovery,removeReviewRecovery} from './nativeReviewRecovery.native';
import {saveEvidenceReview} from './evidenceReviews';
import {loadSubmissionRecovery,removeSubmissionRecovery} from './submissionRecovery.native';
import {replayFrozenSubmission,FrozenSubmissionConflict} from './syncSubmission';
const equal=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);
const cursorRecord='sync-journal-cursor-v1',ledgerRecord='sync-journal-ledger-v1';
export async function readEnrollmentJournalQueue():Promise<{id:string;blocked:string|null}[]>{
  const raw=await nativeVault.read(ledgerRecord);
  const ledger=z.record(z.string().max(256),z.object({key:z.uuid(),attempts:z.number().int().positive(),
    next:z.number().finite().nonnegative(),blocked:z.enum(['CONFLICT','DENIED','INVALID']).nullable()}).strict())
    .parse(raw===null?{}:JSON.parse(raw));
  return Object.entries(ledger).map(([id,value])=>({id,blocked:value.blocked}));
}
export function createEnrollmentJournalSync(request:AuthenticatedRequest,completed:()=>Promise<void>){
  return createOfflineJournalSync({completed,
    readLedger:()=>nativeVault.read(ledgerRecord),writeLedger:value=>nativeVault.write(ledgerRecord,value),
    classify:error=>error instanceof z.ZodError?'INVALID':error instanceof FrozenSubmissionConflict?'CONFLICT':error instanceof ApiError?error.status===409?'CONFLICT':[401,403].includes(error.status)?'DENIED'
      :[400,404,422].includes(error.status)?'INVALID':'RETRY':'RETRY',
    async *entries(signal){
      // Existing journals have hashed filenames, so discover their logical ids
      // through scoped server draft pages. Persist the page cursor to rotate
      // through larger accounts without an unbounded foreground scan.
      const raw=await nativeVault.read(cursorRecord);
      let cursor=z.uuid().nullable().parse(raw===null?null:JSON.parse(raw))??undefined;
      for(let pageNumber=0;pageNumber<10 && !signal.aborted;pageNumber++){
        const page=await readDraftPage(request,cursor,signal);
        for(const draft of page.items){
          if(signal.aborted)return;
          const owner=await loadOwnerRecovery(draft.id),attempt=owner?.pending;
          if(attempt)yield {id:'owner:'+draft.id,key:attempt.key,
            send:async(abort:AbortSignal)=>{
              const scoped:AuthenticatedRequest=(path,options)=>request(path,{...options,signal:abort});
              if(attempt.kind==='details')await saveOwner(scoped,draft.id,attempt.key,attempt.body);
              else await recordOwnerConsent(scoped,draft.id,attempt.key,attempt.body);
            },remove:async()=>{const current=await loadOwnerRecovery(draft.id);
              if(!signal.aborted && equal(current,owner))await removeOwnerRecovery(draft.id);}};
          for(const slot of ['documents','fitting-1','fitting-2','fitting-3','fitting-4']){
            const evidence=await loadPendingEvidence(draft.id,slot);
            if(evidence)yield {id:'evidence:'+draft.id+':'+slot,key:evidence.key,
              send:async(abort:AbortSignal)=>{await uploadEvidence(request,draft.id,evidence.key,evidence.body,abort);},
              remove:async()=>{const current=await loadPendingEvidence(draft.id,slot);
                if(!signal.aborted && equal(current,evidence))await removePendingEvidence(draft.id,slot);}};
          }
          const review=await loadReviewRecovery(draft.id);
          if(review)yield {id:'review:'+draft.id,key:review.key,
            send:async(abort:AbortSignal)=>{const scoped:AuthenticatedRequest=(path,options)=>request(path,{...options,signal:abort});
              await saveEvidenceReview(scoped,draft.id,review.attachmentId,review.key,review.body);},
            remove:async()=>{const current=await loadReviewRecovery(draft.id);
              if(!signal.aborted && equal(current,review))await removeReviewRecovery(draft.id);}};
          const submission=await loadSubmissionRecovery(draft.id);
          if(submission)yield {id:'submission:'+draft.id,key:submission.key,
            send:async(abort:AbortSignal)=>{
              const scoped:AuthenticatedRequest=(path,options)=>request(path,{...options,signal:abort});
              // Never automatically advance a new snapshot or bypass a missing
              // prerequisite/step-up. Only the frozen, previously submitted
              // action may be retried under its current server authorization.
              await replayFrozenSubmission(scoped,draft.id,submission,abort);
            },remove:async()=>{const current=await loadSubmissionRecovery(draft.id);
              if(!signal.aborted && equal(current,submission))await removeSubmissionRecovery(draft.id);}};
        }
        if(signal.aborted)return;
        cursor=page.nextCursor??undefined;
        await nativeVault.write(cursorRecord,JSON.stringify(cursor??null));
        if(!cursor)break;
      }
    },
  });
}
