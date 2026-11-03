import {test} from 'node:test';
import assert from 'node:assert/strict';
import {invitationInput,relationshipPage,acceptedRelationship} from '../src/features/relationships/contracts.ts';
const id='00000000-0000-4000-8000-000000000001';
test('relationship contracts reject unconfirmed consent, delegated approval and private fields',()=>{
 assert.equal(invitationInput.parse({vehicleId:id,kind:'backup',phone:'+243000000001'}).kind,'backup');
 for(const bad of [{vehicleId:id,kind:'seller',phone:'0700000000'},{vehicleId:id,kind:'owner',phone:'+243000000001'}])assert.throws(()=>invitationInput.parse(bad));
 const item={id,vehicleId:id,plate:'TEST',kind:'backup',state:'accepted',asOwner:false,current:true,expiresAt:null,consentVersion:'alert-only-v1',canApprove:false};
 assert.equal(relationshipPage.parse({items:[item],sampleOnly:true}).items[0].canApprove,false);
 for(const changed of [{...item,canApprove:true},{...item,phone:'+243000000001'},{...item,consentVersion:'unknown'}])
  assert.throws(()=>relationshipPage.parse({items:[changed],sampleOnly:true}));
 assert.throws(()=>acceptedRelationship.parse({accepted:false}));assert.throws(()=>acceptedRelationship.parse({accepted:true,otp:'654321'}));
});
