import { z } from 'zod';
import {nativeVault} from '@/features/enrollment/nativeVault.native';
import {reviewAttemptSchema,type ReviewAttempt} from './registrationReviews';
const key=(id:string)=>'authority-review:'+z.uuid().parse(id).toLowerCase();
export async function loadReview(id:string):Promise<ReviewAttempt|null>{const raw=await nativeVault.read(key(id));return raw===null?null:reviewAttemptSchema.parse(JSON.parse(raw));}
export async function persistReview(id:string,value:ReviewAttempt){await nativeVault.write(key(id),JSON.stringify(reviewAttemptSchema.parse(value)));}
export async function clearReview(id:string){await nativeVault.remove(key(id));}
