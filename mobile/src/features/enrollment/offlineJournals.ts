import type { AuthenticatedRequest } from '@/services/api/client';
// Browser recovery is deliberately not a durable private-data queue.
export function createEnrollmentJournalSync(_request:AuthenticatedRequest,_completed:()=>Promise<void>){
  return {configure(_allowed:boolean,_identity:string|null=null){},tick:async()=>{},stop(){}};
}
export async function readEnrollmentJournalQueue():Promise<{id:string;blocked:string|null}[]>{return [];}
