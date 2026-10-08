import test from 'node:test';
import assert from 'node:assert/strict';
import {developmentAgentAllowed,enrollmentRoute,enrollmentSteps,savedWizardSteps,wizardParams} from '../src/features/enrollment/wizard.ts';
import {wizardEn,wizardFr} from '../src/i18n/wizardResources.ts';
const id='00000000-0000-4000-8000-000000000001';
test('connected agent shell is restricted to development and genuine organization-scoped roles',()=>{
  const agent={roles:[{code:'ENROLLMENT_AGENT',organizationId:id}]};
  assert.equal(developmentAgentAllowed(true,agent),true);
  for(const profile of [null,{roles:[]},{roles:[{code:'OWNER',organizationId:id}]},
    {roles:[{code:'ENROLLMENT_AGENT',organizationId:null}]},{roles:[{code:'ENROLLMENT_AGENT',organizationId:'bad'}]}])
    assert.equal(developmentAgentAllowed(true,profile),false);
  assert.equal(developmentAgentAllowed(false,agent),false);
});
test('wizard routes preserve the draft identity, explicitly clear it for new drafts, and reject invalid deep links',()=>{
  for(const step of enrollmentSteps){
    assert.deepEqual(wizardParams(id,step),{id,step,invalid:false});
    assert.deepEqual(enrollmentRoute(step,id),{pathname:'/agent/new-enrollment',params:{id,step}});
  }
  assert.equal(enrollmentRoute().params.id,'new');
  assert.deepEqual(wizardParams('new','vehicle'),{id:undefined,step:'vehicle',invalid:false});
  for(const [value,step] of [['invalid','owner'],[[id],'vehicle'],[id,'payment'],[id,['seals']]])assert.equal(wizardParams(value,step).invalid,true);
  assert.throws(()=>enrollmentRoute('vehicle','invalid'));
});
test('progress counts saved preparation only; stale fitting and production blockers never become completed review',()=>{
  const codes=['VEHICLE_DRAFT','OWNER_SELECTION','OWNER_DETAILS_SAMPLE','CONSENT_SAMPLE','IDENTITY_SAMPLE','REGISTRATION_SAMPLE','VEHICLE_PHOTO_SAMPLE','SEAL_FITTING'];
  const checks=codes.map(code=>({code,status:'COMPLETE'}));
  assert.deepEqual(savedWizardSteps(checks),{vehicle:true,owner:true,documents:true,seals:true,review:false});
  const missing=checks.map(c=>({...c,status:c.code==='SEAL_FITTING'?'STALE':c.code==='CONSENT_SAMPLE'?'MISSING':c.status}));
  assert.equal(savedWizardSteps(missing).seals,false);assert.equal(savedWizardSteps(missing).owner,false);
  assert.equal(savedWizardSteps([{code:'FINALIZATION',status:'COMPLETE'}]).review,false);
  for(const language of [wizardEn,wizardFr])for(const step of enrollmentSteps)assert.ok(language.steps[step]);
});
