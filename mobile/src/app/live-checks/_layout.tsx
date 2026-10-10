import {Redirect,Stack} from 'expo-router';
import {useTranslation} from 'react-i18next';
import {runtime} from '@/config/runtime';
import {useSession} from '@/features/auth/SessionProvider';
import {StitchPage,Copy} from '@/components/ui/Stitch';
export default function Layout(){
  const {profile,loading,error}=useSession(),{t}=useTranslation();
  if(runtime.isDemo)return <Redirect href="/(consumer)"/>;
  if(loading)return <StitchPage><Copy>{t('devAuth.loading')}</Copy></StitchPage>;
  if(error)return <Redirect href="/live-account"/>;
  if(!profile)return <Redirect href="/(auth)/sign-in"/>;
  return <Stack screenOptions={{headerShown:false}}/>;
}
