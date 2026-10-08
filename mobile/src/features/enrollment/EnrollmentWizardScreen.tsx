import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSession } from '@/features/auth/SessionProvider';
import { Action, Card, Copy, Heading, Label, Notice, StitchPage, stitchStyles as u } from '@/components/ui/Stitch';
import { colors } from '@/theme/tokens';
import { readDraft, type EnrollmentDraft } from './drafts';
import { readReadiness } from './readiness';
import { DraftEditor, ErrorNotice } from './LiveDraftScreens';
import EnrollmentOwnerScreen from './EnrollmentOwnerScreen';
import { EvidencePanel } from './EvidencePanel';
import { documentEvidenceKinds } from './evidenceChecklist';
import { EnrollmentSealFitting } from './LiveSealScreens';
import EnrollmentReviewScreen from './EnrollmentReviewScreen';
import { enrollmentRoute, enrollmentSteps, savedWizardSteps, wizardParams, type EnrollmentStep } from './wizard';
import { profileScope } from '@/features/auth/authEvents';
import { workingCopies } from './workingCopies';

export default function EnrollmentWizardScreen() {
  const { t } = useTranslation(); const router = useRouter(); const { profile, request } = useSession();
  const params = useLocalSearchParams<{ id?: string | string[]; step?: string | string[] }>();
  const { id, step, invalid } = wizardParams(params.id, params.step);
  const hasProfile=Boolean(profile);
  const draft = useQuery({ queryKey: ['enrollment-draft', profile?.tenantId, profile?.id, id],
    queryFn: ({ signal }) => readDraft(request, id!, signal), enabled: Boolean(hasProfile && id && !invalid),
    gcTime: 0, retry: false, networkMode: 'always', refetchOnWindowFocus: false });
  const readiness = useQuery({ queryKey: ['enrollment-readiness', profile?.tenantId, profile?.id, id],
    queryFn: ({ signal }) => readReadiness(request, id!, signal), enabled: Boolean(hasProfile && id && !invalid),
    gcTime: 0, retry: false, networkMode: 'always', refetchOnWindowFocus: false });
  const [busy,setBusy]=useState(false),[dirty,setDirty]=useState(false);
  const form=useRef({busy,dirty});
  useEffect(()=>{form.current={busy,dirty};},[busy,dirty]);
  const {refetch:refreshDraft}=draft,{refetch:refreshReadiness}=readiness;
  useFocusEffect(useCallback(()=>{
    if(hasProfile && id && !invalid && !form.current.busy && !form.current.dirty){void refreshDraft();void refreshReadiness();}
  },[hasProfile,id,invalid,refreshDraft,refreshReadiness]));
  const saved=readiness.data && !readiness.isFetching && !readiness.isError?savedWizardSteps(readiness.data.checks):undefined;
  const index=enrollmentSteps.indexOf(step);
  const loading=Boolean(id && (draft.isPending || draft.isFetching));
  const available=!invalid && (!id || Boolean(draft.data && !draft.isError && !loading));
  const changed=busy || dirty;
  function go(next:EnrollmentStep){if(!changed)router.setParams(enrollmentRoute(next,id).params);}
  function vehicleSaved(value:EnrollmentDraft){
    setDirty(false);setBusy(false);router.setParams(enrollmentRoute('owner',value.id).params);
    if(id)void refreshReadiness();
  }
  const vehicle=draft.data?.vehicle;
  return <StitchPage>
    <Notice tone="warning">{t('enrollmentWizard.notice')}</Notice>
    <View style={{gap:8}}>
      <Label>{t('enrollmentWizard.step',{number:index+1,total:enrollmentSteps.length,title:t('enrollmentWizard.steps.'+step)})}</Label>
      <View style={{flexDirection:'row',gap:5}}>{enrollmentSteps.map((value,i)=>{
        const complete=saved?.[value]??false;
        const disabled=changed || invalid || (!id && value!=='vehicle');
        return <Pressable key={value} accessibilityRole="button" accessibilityLabel={t('enrollmentWizard.steps.'+value)}
          accessibilityState={{selected:value===step,disabled}} disabled={disabled} onPress={()=>go(value)}
          style={{flex:1,minHeight:64,gap:6,justifyContent:'flex-start',opacity:disabled && value!==step?0.55:1}}>
          <View style={{height:7,borderRadius:4,backgroundColor:value===step?colors.primary:complete?colors.success:colors.border,
            borderWidth:value===step?1:0,borderColor:colors.accent}}/>
          <Copy style={{fontSize:11,lineHeight:15,textAlign:'center',fontWeight:value===step?'700':'400'}}>{i+1}. {t('enrollmentWizard.steps.'+value)}</Copy>
          {complete && <Ionicons style={{alignSelf:'center'}} name="checkmark-circle-outline" size={16} color={colors.success}/>}
        </Pressable>;
      })}</View>
      {saved && <Copy>{t('enrollmentWizard.savedSteps',{count:Object.values(saved).filter(Boolean).length})}</Copy>}
    </View>
    {invalid && <Notice tone="danger">{t('liveEnrollment.unavailable')}</Notice>}
    {loading && !invalid && <Copy>{t('liveEnrollment.loading')}</Copy>}
    {id && !loading && draft.isError && <ErrorNotice error={draft.error}/>}
    {available && <>
      <View style={[u.inset,{borderLeftWidth:4,borderLeftColor:colors.warning}]}>
        <Label>{t('enrollmentWizard.summary')}</Label>
        <Heading>{vehicle?[vehicle.make,vehicle.model,vehicle.manufactureYear].filter(Boolean).join(' ')||vehicle.plate||vehicle.chassisIdentifier:t('enrollmentWizard.noVehicle')}</Heading>
        {vehicle && <Copy>{t('stitch.vin')}: {vehicle.chassisIdentifier}</Copy>}
        <Copy style={{color:colors.warning}}>{t('liveEnrollment.draft')}</Copy>
        <Copy>{id?t('enrollmentWizard.connected')+' · '+t('liveEnrollment.revision',{revision:draft.data!.revision}):t('enrollmentWizard.newDraft')}</Copy>
      </View>
      {step==='vehicle' && <DraftEditor key={[id??'new',draft.dataUpdatedAt].join(':')} draft={draft.data}
        onSaved={vehicleSaved} onBusyChange={setBusy} onDirtyChange={setDirty}/>}
      {id && step==='vehicle' && <Action secondary label={t('liveEnrollment.reload')} disabled={busy || loading} onPress={()=>{
        workingCopies.remove(profile?profileScope(profile):'','vehicle',id);void refreshDraft();void refreshReadiness();
      }}/>}
      {!id && step!=='vehicle' && <Notice>{t('enrollmentWizard.saveFirst')}</Notice>}
      {id && step==='owner' && <EnrollmentOwnerScreen embedded onBusyChange={setBusy} onDirtyChange={setDirty}/>}
      {id && step==='documents' && <><Notice>{t('enrollmentWizard.ownerFirst')}</Notice>
        <EvidencePanel draftId={id} kinds={documentEvidenceKinds}
          disabled={!readiness.data?.checks.some(c=>c.code==='OWNER_DETAILS_SAMPLE' && c.status==='COMPLETE') || readiness.isFetching || readiness.isError}
          onBusyChange={setBusy} onUploaded={()=>void refreshReadiness()}/></>}
      {id && step==='seals' && <EnrollmentSealFitting embedded onBusyChange={setBusy} onDirtyChange={setDirty}
        onSaved={result=>{setDirty(false);setBusy(false);void refreshReadiness();if(result.sealDraftComplete)router.setParams(enrollmentRoute('review',id).params);}}/>}
      {id && step==='review' && <EnrollmentReviewScreen embedded/>}
      {dirty && <Notice>{t('enrollmentWizard.saveChanges')}</Notice>}
      {id && step!=='vehicle' && step!=='seals' && step!=='review' && <Action label={t('enrollmentWizard.next',{step:t('enrollmentWizard.steps.'+enrollmentSteps[index+1])})}
        disabled={changed || !saved?.[step]} onPress={()=>go(enrollmentSteps[index+1])} icon="arrow-forward-outline"/>}
      {id && index>0 && <Action secondary label={t('enrollmentWizard.previous')} disabled={changed} onPress={()=>go(enrollmentSteps[index-1])}/>}
    </>}
    {id && draft.isError && <Action label={t('liveEnrollment.reload')} disabled={loading} onPress={()=>void refreshDraft()}/>}
    <Card><Copy>{t('enrollmentWizard.noOffline')}</Copy></Card>
    <Action secondary label={t('enrollmentWizard.listBack')} disabled={busy || (dirty && step==='owner')} onPress={()=>router.navigate('/agent')}/>
  </StitchPage>;
}
