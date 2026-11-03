import { useSyncExternalStore } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { useSession } from '@/features/auth/SessionProvider';
import { profileScope } from '@/features/auth/authEvents';
import { Action, Card, Copy, Heading, Notice } from '@/components/ui/Stitch';
import { workingCopies } from './workingCopies';
import { enrollmentRoute } from './wizard';
import { readEnrollmentJournalQueue } from './offlineJournals';
export function OfflineSyncQueue(){
  const {profile}=useSession(),router=useRouter(),{t}=useTranslation();
  const status=useSyncExternalStore(workingCopies.subscribe,workingCopies.getStatus,workingCopies.getStatus);
  const entries=profile?workingCopies.list(profileScope(profile)).filter(entry=>entry.copy.pending):[];
  const journals=useQuery({queryKey:['offline-sync-journals',profile?.tenantId,profile?.id],queryFn:readEnrollmentJournalQueue,
    enabled:Boolean(profile && Platform.OS!=='web'),gcTime:0,retry:false,networkMode:'always',refetchInterval:30000});
  return <><Heading>{t('offlineSync.title')}</Heading><Notice>{t('offlineSync.notice')}</Notice>
    {!profile && <Notice>{t('offlineSync.locked')}</Notice>}
    {status==='failed' && <Notice tone="danger">{t('offlineSync.storageFailed')}</Notice>}
    {profile && !entries.length && !journals.data?.length && <Copy>{t('offlineSync.empty')}</Copy>}
    {entries.map(entry=><Card key={entry.copy.kind+entry.id}>
      <Copy>{entry.copy.kind==='vehicle'?entry.copy.fields.plate || entry.copy.fields.chassisIdentifier:entry.id}</Copy>
      <Notice tone={entry.copy.sync?.blocked?'danger':'warning'}>{t('offlineSync.'+
        (entry.copy.sync?.blocked==='CONFLICT'?'conflict':entry.copy.sync?.blocked==='DENIED'?'denied'
          :entry.copy.sync?.blocked==='INVALID'?'invalid':entry.copy.sync?'retry':'pending'))}</Notice>
      <Action secondary label={t('offlineSync.open')} onPress={()=>router.navigate(enrollmentRoute(
        entry.copy.kind==='seals'?'seals':'vehicle',entry.id==='new'?undefined:entry.id))}/>
    </Card>)}
    {journals.isError && <Notice tone="danger">{t('offlineSync.storageFailed')}</Notice>}
    {journals.data?.map(entry=>{
      const [kind,draftId]=entry.id.split(':');
      return <Card key={entry.id}><Copy>{t('offlineSync.journal.'+kind)}</Copy>
        <Notice tone={entry.blocked?'danger':'warning'}>{t('offlineSync.'+(entry.blocked==='CONFLICT'?'conflict'
          :entry.blocked==='DENIED'?'denied':entry.blocked==='INVALID'?'invalid':'retry'))}</Notice>
        <Action secondary label={t('offlineSync.open')} onPress={()=>router.navigate(enrollmentRoute(
          kind==='owner'?'owner':kind==='evidence'?'documents':'review',draftId))}/>
      </Card>;
    })}
  </>;
}
