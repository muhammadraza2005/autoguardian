import {readSubmission,executeSubmission,type SubmissionAttempt} from './submission.ts';
type Request=Parameters<typeof readSubmission>[0];
export class FrozenSubmissionConflict extends Error {}
export async function replayFrozenSubmission(request:Request,draftId:string,attempt:SubmissionAttempt,signal:AbortSignal){
  const state=await readSubmission(request,draftId,signal);
  const alreadyCompleted=attempt.action==='submit'?state.status!=='DRAFT':state.status==='ACTIVE';
  if(state.draftRevision!==attempt.body.expectedDraftRevision || state.snapshotRevision!==attempt.body.expectedSnapshotRevision
    || (!alreadyCompleted && (attempt.action==='submit'?!state.canSubmit:!state.canFinalize)))throw new FrozenSubmissionConflict('Review submission again.');
  if(signal.aborted)throw new FrozenSubmissionConflict('Synchronization paused.');
  // For an already-completed operation, the existing server replay branch must
  // still match its original action key. A status alone is not confirmation of
  // this attempt; a different key is rejected by the backend.
  return executeSubmission(request,draftId,attempt);
}
