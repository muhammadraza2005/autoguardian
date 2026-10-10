import type {ReviewAttempt} from './registrationReviews';
export async function loadReview(_id:string):Promise<ReviewAttempt|null>{return null;}
export async function persistReview(_id:string,_value:ReviewAttempt){}
export async function clearReview(_id:string){}
