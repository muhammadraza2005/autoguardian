import { z } from 'zod';
import {nativeVault} from './nativeVault.native';
import {submissionAttemptSchema,type SubmissionAttempt} from './submission';
const key=(id:string)=>'submission:'+z.uuid().parse(id).toLowerCase();
export async function loadSubmissionRecovery(id:string):Promise<SubmissionAttempt|null>{
  const raw=await nativeVault.read(key(id));return raw===null?null:submissionAttemptSchema.parse(JSON.parse(raw));
}
export async function saveSubmissionRecovery(id:string,value:SubmissionAttempt){await nativeVault.write(key(id),JSON.stringify(submissionAttemptSchema.parse(value)));}
export async function removeSubmissionRecovery(id:string){await nativeVault.remove(key(id));}
