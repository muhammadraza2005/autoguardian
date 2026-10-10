import type {EvidenceReviewAttempt} from './evidenceReviews';
export async function loadReviewRecovery(_id:string):Promise<EvidenceReviewAttempt|null>{return null;}
export async function saveReviewRecovery(_id:string,_attempt:EvidenceReviewAttempt):Promise<void>{}
export async function removeReviewRecovery(_id:string):Promise<void>{}
