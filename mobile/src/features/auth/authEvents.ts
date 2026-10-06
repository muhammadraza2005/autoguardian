import type {AccountProfile} from './profile';
export function preserveAuthView(event:string,previousSubject:string|undefined,nextSubject:string|undefined,profileReady:boolean){
  return profileReady && Boolean(previousSubject) && previousSubject===nextSubject
    && ['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED'].includes(event);
}
export function profileScope(profile:AccountProfile){
  return JSON.stringify([profile.tenantId,profile.id,profile.roles.map(r=>[r.code,r.organizationId]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
}
