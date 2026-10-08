import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, Copy, Heading, Label, Notice } from '@/components/ui/Stitch';
import type { SealValidation } from './sealValidation';

export function SealValidationSummary({value,saved=false}:{value:SealValidation;saved?:boolean}) {
  const {t}=useTranslation();
  return <Card>
    <Heading>{t('liveSeals.validation.title')}</Heading>
    <Copy>{t(saved?'liveSeals.validation.saved':'liveSeals.validation.checked')}</Copy>
    <Notice tone={value.complete?'neutral':'warning'}>{t('liveSeals.validation.'+(value.complete?'complete':'incomplete'))}</Notice>
    {value.issues.map(issue=><Copy key={issue}>{t('liveSeals.validation.issues.'+issue)}</Copy>)}
    {value.required && value.slots.map(slot=><View key={slot.position} style={{gap:6}}>
      <Label>{t('liveSeals.position',{number:slot.position})}</Label>
      {slot.issues.length?slot.issues.map(issue=><Copy key={issue}>{t('liveSeals.validation.issues.'+issue)}</Copy>)
        :<Copy>{t('liveSeals.validation.slotComplete')}</Copy>}
    </View>)}
    <Copy>{t('liveSeals.validation.physicalPending')}</Copy>
  </Card>;
}
