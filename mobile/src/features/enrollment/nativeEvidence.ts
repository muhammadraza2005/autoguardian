import type { EvidenceKind } from './evidence';
import type { PendingEvidence } from './pendingEvidence';
export async function loadPendingEvidence(_draftId:string,_slot:string):Promise<PendingEvidence|null>{return null;}
export async function savePendingEvidence(_draftId:string,_slot:string,_value:PendingEvidence):Promise<void>{}
export async function removePendingEvidence(_draftId:string,_slot:string):Promise<void>{}
export async function pickNativeEvidence(_kind:EvidenceKind,_camera:boolean):Promise<{dataUrl:string;size:number}|null>{
  throw new Error('Native capture is unavailable in the browser.');
}
