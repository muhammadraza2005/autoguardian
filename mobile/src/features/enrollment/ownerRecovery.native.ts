import { z } from 'zod';
import { nativeVault } from './nativeVault.native';
import { ownerRecoverySchema, type OwnerRecovery } from './ownerRecoverySchema';
const record=(id:string)=>'owner:'+z.uuid().parse(id).toLowerCase();
export async function loadOwnerRecovery(id:string):Promise<OwnerRecovery|null>{
  const raw=await nativeVault.read(record(id));return raw===null?null:ownerRecoverySchema.parse(JSON.parse(raw));
}
export async function saveOwnerRecovery(id:string,value:OwnerRecovery){
  await nativeVault.write(record(id),JSON.stringify(ownerRecoverySchema.parse(value)));
}
export async function removeOwnerRecovery(id:string){await nativeVault.remove(record(id));}
