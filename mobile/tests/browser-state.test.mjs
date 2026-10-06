import test from 'node:test';import assert from 'node:assert/strict';
import {createTabStorage} from '../src/services/storage/tabStorage.ts';
import {createWorkingCopyStore} from '../src/features/enrollment/workingCopyStore.ts';
import {preserveAuthView,profileScope} from '../src/features/auth/authEvents.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function browser(){const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};}
test('tab auth survives a new adapter after refresh, sign-out removes it, and unavailable storage falls back to memory',()=>{
  const backing=browser(),before=createTabStorage(()=>backing);before.setItem('synthetic-session','synthetic-token');
  const after=createTabStorage(()=>backing);assert.equal(after.getItem('synthetic-session'),'synthetic-token');
  after.removeItem('synthetic-session');assert.equal(createTabStorage(()=>backing).getItem('synthetic-session'),null);
  const blocked=createTabStorage(()=>{throw new Error('Storage blocked');});blocked.setItem('test','value');assert.equal(blocked.getItem('test'),'value');
  blocked.removeItem('test');assert.equal(blocked.getItem('test'),null);
  const memory=createTabStorage(()=>null);memory.setItem('test','value');assert.equal(createTabStorage(()=>null).getItem('test'),null);
});
test('returning to the tab and refreshing tokens preserve the verified account; sign-out and identity/scope changes do not',()=>{
  for(const event of ['SIGNED_IN','TOKEN_REFRESHED','INITIAL_SESSION'])assert.equal(preserveAuthView(event,id(1),id(1),true),true);
  for(const [event,previous,next,ready] of [['SIGNED_OUT',id(1),undefined,true],['SIGNED_IN',id(1),id(2),true],['SIGNED_IN',id(1),id(1),false],['USER_UPDATED',id(1),id(1),true]])
    assert.equal(preserveAuthView(event,previous,next,ready),false);
  const profile={id:id(1),tenantId:id(2),preferredLanguage:'en',roles:[{code:'ENROLLMENT_AGENT',organizationId:id(3)},{code:'VERIFIER',organizationId:null}]};
  assert.equal(profileScope(profile),profileScope({...profile,roles:[...profile.roles].reverse(),preferredLanguage:'fr'}));
  assert.notEqual(profileScope(profile),profileScope({...profile,roles:[]}));
  assert.notEqual(profileScope(profile),profileScope({...profile,tenantId:id(4)}));
});
test('working forms and replay keys recover after reload, remain account scoped, reject file bytes and clear on sign-out',()=>{
  const backing=browser(),scope='synthetic-account-A',first=createWorkingCopyStore(createTabStorage(()=>backing));first.identify(scope);
  const body={expectedDraftRevision:1,expectedFittingRevision:0,package:'STANDARD',placements:[{position:1,sealCode:'DEV-SEAL-STD-001',photoId:id(3)}]};
  const copy={kind:'seals',draftRevision:1,fittingRevision:0,package:'STANDARD',slots:[1,2,3,4].map(position=>({position,sealCode:position===1?'DEV-SEAL-STD-001':'',photoId:position===1?id(3):null})),pending:{key:id(4),body}};
  first.write(scope,id(1),copy);
  const refreshed=createWorkingCopyStore(createTabStorage(()=>backing));refreshed.identify(scope);
  assert.deepEqual(refreshed.read(scope,'seals',id(1)),copy);assert.equal(refreshed.read('other-account','seals',id(1)),null);
  refreshed.write(scope,id(1),{...copy,dataBase64:'private bytes not allowed'});assert.deepEqual(refreshed.read(scope,'seals',id(1)),copy);
  refreshed.remove(scope,'seals',id(1));assert.equal(refreshed.read(scope,'seals',id(1)),null);
  refreshed.write(scope,id(1),copy);refreshed.identify('synthetic-account-B');assert.equal(refreshed.read(scope,'seals',id(1)),null);
  refreshed.identify(scope);assert.equal(refreshed.read(scope,'seals',id(1)),null);
  refreshed.write(scope,id(1),copy);refreshed.clear();assert.equal(createWorkingCopyStore(createTabStorage(()=>backing)).read(scope,'seals',id(1)),null);
});
