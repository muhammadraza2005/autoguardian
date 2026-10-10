import {z} from 'zod';
import {nativeVault} from './nativeVault.native';
import {evidenceReviewAttemptSchema,type EvidenceReviewAttempt} from './evidenceReviews';
const record=(id:string)=>'review:'+z.uuid().parse(id).toLowerCase();
export async function loadReviewRecovery(id:string):Promise<EvidenceReviewAttempt|null>{
  const raw=await nativeVault.read(record(id));return raw===null?null:evidenceReviewAttemptSchema.parse(JSON.parse(raw));
}
export async function saveReviewRecovery(id:string,attempt:EvidenceReviewAttempt){
  await nativeVault.write(record(id),JSON.stringify(evidenceReviewAttemptSchema.parse(attempt)));
}
export async function removeReviewRecovery(id:string){await nativeVault.remove(record(id));}
