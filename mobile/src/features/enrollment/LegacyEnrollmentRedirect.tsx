import { Redirect, useLocalSearchParams } from 'expo-router';
import { Notice, StitchPage } from '@/components/ui/Stitch';
import { useTranslation } from 'react-i18next';
import { enrollmentRoute, wizardParams, type EnrollmentStep } from './wizard';

export function LegacyEnrollmentRedirect({step='vehicle',newDraft=false}:{step?:EnrollmentStep;newDraft?:boolean}) {
  const {id}=useLocalSearchParams<{id?:string|string[]}>();const {t}=useTranslation();
  const parsed=wizardParams(id,step);
  if(!newDraft && (!parsed.id || parsed.invalid))return <StitchPage><Notice tone="danger">{t('liveEnrollment.unavailable')}</Notice></StitchPage>;
  return <Redirect href={enrollmentRoute(step,newDraft?undefined:parsed.id)}/>;
}
export function LegacyVehicle(){return <LegacyEnrollmentRedirect/>;}
export function LegacyNew(){return <LegacyEnrollmentRedirect newDraft/>;}
export function LegacyOwner(){return <LegacyEnrollmentRedirect step="owner"/>;}
export function LegacyDocuments(){return <LegacyEnrollmentRedirect step="documents"/>;}
export function LegacySeals(){return <LegacyEnrollmentRedirect step="seals"/>;}
export function LegacyReview(){return <LegacyEnrollmentRedirect step="review"/>;}
export function LegacyStock(){
  const {organizationId}=useLocalSearchParams<{organizationId?:string|string[]}>();
  return <Redirect href={{pathname:'/agent/seal-stock',params:typeof organizationId==='string'?{organizationId}:{}}}/>;
}
