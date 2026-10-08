import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, Copy, Heading, Label } from '@/components/ui/Stitch';
import { evidenceRequirements, type EvidenceChecklist as Checklist } from './evidenceChecklist';

export function EvidenceRequirementList({ value, actions }: { value: Checklist; actions?: (kinds: readonly string[]) => ReactNode }) {
  const { t } = useTranslation();
  const completed=value.items.filter(item=>item.status==='COMPLETE').length;
  return <>
    <Heading>{t('liveEvidence.checklistTitle')}</Heading>
    <Copy>{t('liveEvidence.checklistProgress',{count:completed,total:evidenceRequirements.length})}</Copy>
    <Copy>{t('liveEvidence.checklistHint')}</Copy>
    {evidenceRequirements.map(requirement=><Card key={requirement.code}>
      <Label>{t('liveEvidence.requirements.'+requirement.code)}</Label>
      <Copy>{t('liveEvidence.checklistStatuses.'+value.items.find(item=>item.code===requirement.code)!.status)}</Copy>
      {actions && <View style={{gap:8}}>{actions(requirement.kinds)}</View>}
    </Card>)}
  </>;
}
