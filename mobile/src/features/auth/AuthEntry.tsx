import { runtime } from '@/config/runtime';
import EmailAccessScreen from './EmailAccessScreen';
import PhoneAccessScreen from './PhoneAccessScreen';
import LivePhoneScreen from './LivePhoneScreen';
import {Redirect} from 'expo-router';
import {useSession} from './SessionProvider';

export default function AuthEntry() {
  const {offlineReadOnly}=useSession();
  if(offlineReadOnly)return <Redirect href="/live-account"/>;
  return runtime.isDemo ? <PhoneAccessScreen /> : runtime.developmentEmailAuth ? <EmailAccessScreen /> : <LivePhoneScreen />;
}
