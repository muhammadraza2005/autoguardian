import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ownerPinStatus,pinInput,requestPinProof} from '../src/features/ownerPin/contracts.ts';
const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',proof='a'.repeat(64);
test('owner PIN status and actions reject invented success, mismatched targets and exposed credentials',async()=>{
 assert.equal(pinInput('1234'),true);assert.equal(pinInput('123456'),true);
 for(const pin of ['123','1234567','12ab',''])assert.equal(pinInput(pin),false);
 assert.throws(()=>ownerPinStatus.parse({policyEnabled:true,configured:true,phoneCurrent:true,cooldown:false,credential:'secret'}));
 const action={requestId:id,decision:'approved'};
 let input;const request=async(path,options)=>{input={path,...options};return {proof,...action};};
 assert.equal(await requestPinProof(request,action,'142536'),proof);assert.equal(input.path,'/v1/me/owner-pin/proofs');assert.equal(input.body.pin,'142536');
 await assert.rejects(requestPinProof(async()=>({proof,requestId:other,decision:'approved'}),action,'142536'));
 await assert.rejects(requestPinProof(async()=>({proof,...action,credential:'secret'}),action,'142536'));
 await assert.rejects(requestPinProof(async()=>({proof,...action,decision:'refused'}),action,'142536'));
 await assert.rejects(requestPinProof(request,action,'123'));
 const sale={vehicleId:id,requestKey:other,expectedStatus:'NOT_FOR_SALE',saleStatus:'FOR_SALE',reason:'Listing vehicle'};
 assert.equal(await requestPinProof(async()=>({proof,vehicleId:id,action:'sale_status'}),sale,'142536'),proof);
 await assert.rejects(requestPinProof(async()=>({proof,vehicleId:other,action:'sale_status'}),sale,'142536'));
});
