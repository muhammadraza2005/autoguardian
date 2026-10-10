import {useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';
import {z} from 'zod';
import {useSession} from '@/features/auth/SessionProvider';
import {Action,Card,Copy,Heading,Notice} from '@/components/ui/Stitch';
const schema=z.object({draftId:z.uuid(),snapshotRevision:z.number().int().positive(),items:z.array(z.object({id:z.uuid(),kind:z.string(),
  decision:z.enum(['NOT_REVIEWED','ACCEPTED','NEEDS_CORRECTION','SUPERSEDED']),reason:z.string().nullable(),replacementId:z.uuid().nullable()}).strict())}).strict();
export function AuthorityReviewFeedback({draftId}:{draftId:string}){
  const {t}=useTranslation();const {profile,request}=useSession();
  const query=useQuery({queryKey:['authority-feedback',profile?.tenantId,profile?.id,draftId],queryFn:async({signal})=>{
    const value=schema.parse(await request('/v1/registration-reviews/'+z.uuid().parse(draftId)+'/feedback',{signal}));
    if(value.draftId!==draftId)throw new Error('Unexpected review.');return value;
  },gcTime:0,retry:false,refetchOnWindowFocus:false});
  return <Card><Heading>{t('registrationReview.title')}</Heading>
    {query.isFetching&&<Copy>{t('registrationReview.loading')}</Copy>}
    {query.isError&&<Notice tone="warning">{t('registrationReview.failed')}</Notice>}
    {!query.isFetching&&!query.isError&&query.data?.items.map(item=><Copy key={item.id} selectable>{t('liveEvidence.kinds.'+item.kind)+' · '+item.id+' · '+
      t('registrationReview.decisions.'+item.decision)+(item.reason?' · '+t('registrationReview.reasons.'+item.reason):'')+(item.replacementId?' → '+item.replacementId:'')}</Copy>)}
    <Action secondary disabled={query.isFetching} label={t('registrationReview.refresh')} onPress={()=>void query.refetch()}/>
  </Card>;
}
