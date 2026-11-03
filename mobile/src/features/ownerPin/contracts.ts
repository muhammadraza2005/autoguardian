import {z} from 'zod';
import type {AuthenticatedRequest} from '../../services/api/client';
export const ownerPinStatus=z.object({policyEnabled:z.boolean(),configured:z.boolean(),phoneCurrent:z.boolean(),cooldown:z.boolean()}).strict();
export const pinInput=(value:string)=>/^\d{4,6}$/.test(value);
export type PinAction={requestId:string;decision:'approved'|'refused'}|{vehicleId:string;requestKey:string;expectedStatus:string;saleStatus:string;reason:string};
export async function requestPinProof(request:AuthenticatedRequest,action:PinAction,pin:string,signal?:AbortSignal){
 if(!pinInput(pin))throw new Error('Invalid PIN input');
 const reply=await request('/v1/me/owner-pin/proofs',{method:'POST',body:{...action,pin},signal});
 const proof=z.string().regex(/^[a-f0-9]{64}$/);
 if('requestId' in action){const parsed=z.object({proof,requestId:z.uuid(),decision:z.enum(['approved','refused'])}).strict().parse(reply);
  if(parsed.requestId!==action.requestId||parsed.decision!==action.decision)throw new Error('Proof action mismatch');return parsed.proof;}
 const parsed=z.object({proof,vehicleId:z.uuid(),action:z.literal('sale_status')}).strict().parse(reply);
 if(parsed.vehicleId!==action.vehicleId)throw new Error('Proof action mismatch');return parsed.proof;
}
