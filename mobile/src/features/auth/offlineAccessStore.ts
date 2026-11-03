import type {AccountProfile} from './profile';
export const offlineAccess={async save(_identity:{authUserId:string;sessionId:string},_profile:AccountProfile,_lease:unknown){},
 async recover(_identity:{authUserId:string;sessionId:string}):Promise<{profile:AccountProfile;expiresAt:number}|null>{return null;},async clear(){}};
