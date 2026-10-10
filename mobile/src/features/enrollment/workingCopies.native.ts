import { nativeVault } from './nativeVault.native';
import { createNativeWorkingCopies } from './nativeWorkingCopyStore';
import { clearEvidenceCaptureCache } from './nativeEvidence.native';
const copies = createNativeWorkingCopies(nativeVault);
let captureCachePrepared=false;
export const workingCopies = {...copies,async prepare(scope:string){
  if(!captureCachePrepared){await clearEvidenceCaptureCache();captureCachePrepared=true;}
  await copies.prepare(scope);
}};
