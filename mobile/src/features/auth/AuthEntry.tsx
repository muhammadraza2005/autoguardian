import { runtime } from '@/config/runtime';
import EmailAccessScreen from './EmailAccessScreen';
import PhoneAccessScreen from './PhoneAccessScreen';
import LivePhoneScreen from './LivePhoneScreen';

export default function AuthEntry() {
  return runtime.isDemo ? <PhoneAccessScreen /> : runtime.developmentEmailAuth ? <EmailAccessScreen /> : <LivePhoneScreen />;
}
